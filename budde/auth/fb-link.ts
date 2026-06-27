import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import { getAuthData } from "~encore/auth";
import crypto from "node:crypto";
import { db } from "./db";
import { fbLinkCache, profileCache } from "./cache";
import type { AuthData } from "./auth";

// ---- Types ----

interface FbLinkRequest {
  fb_psid: string;
}

export interface FbLinkProfile {
  full_name: string;
  grade: string;
  subjects: string[];
  weak_topics: string[];
  availability: Record<string, unknown>;
  exam_dates: Record<string, string>;
  target_scores: Record<string, number>;
  planning_preferences: Record<string, unknown>;
  goals: string;
}

interface FbLinkResponse {
  linked: boolean;
  code?: string;
  profile?: FbLinkProfile;
}

interface LinkAccountRequest {
  code: string;
}

interface LinkAccountResponse {
  ok: boolean;
  fb_psid: string;
}

interface LinkStatusResponse {
  linked: boolean;
  fb_psid?: string;
}

interface UnlinkResponse {
  ok: boolean;
}

interface FbLinkRow {
  id: number;
  fb_psid: string;
  unique_code: string;
  user_id: string | null;
  created_at: Date;
  linked_at: Date | null;
}

// ---- Helpers ----

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1 to avoid confusion

function generateCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// ---- Profile DB (cross-service reference) ----

const profileDb = SQLDatabase.named("profile");

interface ProfileRow {
  full_name: string;
  grade: string;
  subjects: unknown;
  weak_topics: unknown;
  availability: unknown;
  exam_dates: unknown;
  target_scores: unknown;
  planning_preferences: unknown;
  goals: string | null;
}

function parseProfileRow(row: ProfileRow): FbLinkProfile {
  return {
    full_name: row.full_name || "",
    grade: row.grade || "",
    subjects: Array.isArray(row.subjects) ? row.subjects.map(String).filter(Boolean) : [],
    weak_topics: Array.isArray(row.weak_topics) ? row.weak_topics.map(String).filter(Boolean) : [],
    availability: (row.availability && typeof row.availability === "object") ? (row.availability as Record<string, unknown>) : {},
    exam_dates: (row.exam_dates && typeof row.exam_dates === "object") ? (row.exam_dates as Record<string, string>) : {},
    target_scores: (row.target_scores && typeof row.target_scores === "object") ? (row.target_scores as Record<string, number>) : {},
    planning_preferences: (row.planning_preferences && typeof row.planning_preferences === "object") ? (row.planning_preferences as Record<string, unknown>) : {},
    goals: row.goals || "",
  };
}

/** Load profile from cache or DB, given a user_id. Returns an empty profile if none exists. */
async function loadProfile(userId: string): Promise<FbLinkProfile> {
  const cached = await profileCache.get({ userId });
  if (cached) return cached;

  const pRow = await profileDb.queryRow<ProfileRow>`
    SELECT full_name, grade, subjects, weak_topics, availability,
           exam_dates, target_scores, planning_preferences, goals
    FROM profiles WHERE user_id = ${userId}
  `;
  if (!pRow) return emptyProfile();

  const profile = parseProfileRow(pRow);
  await profileCache.set({ userId }, profile);
  return profile;
}

function emptyProfile(): FbLinkProfile {
  return {
    full_name: "",
    grade: "",
    subjects: [],
    weak_topics: [],
    availability: {},
    exam_dates: {},
    target_scores: {},
    planning_preferences: {},
    goals: "",
  };
}

// ---- Endpoints ----

/**
 * POST /fb/link
 * Kiểm tra fb_psid đã link chưa. Nếu chưa, gen mã unique 1 lần duy nhất.
 * Cho n8n gọi khi user nhắn tin vào Fanpage.
 */
export const link = api(
  { expose: true, method: "POST", path: "/fb/link" },
  async (p: FbLinkRequest): Promise<FbLinkResponse> => {
    if (!p.fb_psid || p.fb_psid.trim().length === 0) {
      throw APIError.invalidArgument("fb_psid is required");
    }

    const fb_psid = p.fb_psid.trim();

    // Cache-first: bỏ qua DB query nếu đã biết user đã link
    const cachedUserId = await fbLinkCache.get({ fbPsid: fb_psid });
    if (cachedUserId) {
      // Cache hit — trả luôn cả profile
      const profile = await loadProfile(cachedUserId);
      return { linked: true, profile };
    }

    // Atomic insert-or-get — avoids race condition between SELECT and INSERT
    let code = generateCode();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await db.exec`
          INSERT INTO fb_links (fb_psid, unique_code)
          VALUES (${fb_psid}, ${code})
          ON CONFLICT (fb_psid) DO NOTHING
        `;
        break;
      } catch {
        code = generateCode();
      }
    }

    const row = await db.queryRow<FbLinkRow>`
      SELECT id, fb_psid, unique_code, user_id, created_at, linked_at
      FROM fb_links
      WHERE fb_psid = ${fb_psid}
    `;
    if (!row) throw APIError.internal("failed to create fb link record");
    if (row.user_id) {
      await fbLinkCache.set({ fbPsid: fb_psid }, row.user_id);
      const profile = await loadProfile(row.user_id);
      return { linked: true, profile };
    }
    return { linked: false, code: row.unique_code };
  },
);

/**
 * POST /fb/link-account
 * Link fb_psid với user đang login dựa vào unique_code.
 * User gọi từ Settings → Link Facebook sau khi register.
 */
export const linkAccount = api(
  { expose: true, auth: true, method: "POST", path: "/fb/link-account" },
  async (p: LinkAccountRequest): Promise<LinkAccountResponse> => {
    if (!p.code || p.code.trim().length === 0) {
      throw APIError.invalidArgument("code is required");
    }

    const code = p.code.trim().toUpperCase();
    const auth = (getAuthData as () => AuthData | null)();
    if (!auth) {
      throw APIError.unauthenticated("authentication required");
    }

    // Tìm record theo code
    const record = await db.queryRow<FbLinkRow>`
      SELECT id, fb_psid, unique_code, user_id, created_at, linked_at
      FROM fb_links
      WHERE unique_code = ${code}
    `;

    if (!record) {
      throw APIError.notFound("Invalid code. Please check the code from your Messenger message.");
    }

    if (record.user_id) {
      throw APIError.alreadyExists("This code has already been used.");
    }

    // Link: gán user_id
    await db.exec`
      UPDATE fb_links
      SET user_id = ${auth.userID}, linked_at = NOW()
      WHERE id = ${record.id}
    `;

    // Invalidate cache để force refresh ở lần gọi tiếp theo
    await fbLinkCache.delete({ fbPsid: record.fb_psid });

    return { ok: true, fb_psid: record.fb_psid };
  },
);

/**
 * GET /fb/link
 * Kiểm tra trạng thái liên kết Facebook của user đang login.
 * Dùng cho Settings page hiển thị trạng thái.
 */
export const status = api(
  { expose: true, auth: true, method: "GET", path: "/fb/link" },
  async (): Promise<LinkStatusResponse> => {
    const auth = (getAuthData as () => AuthData | null)();
    if (!auth) throw APIError.unauthenticated("authentication required");

    const record = await db.queryRow<FbLinkRow>`
      SELECT id, fb_psid, unique_code, user_id, created_at, linked_at
      FROM fb_links
      WHERE user_id = ${auth.userID}
    `;

    if (!record) {
      return { linked: false };
    }

    return { linked: true, fb_psid: record.fb_psid };
  },
);

/**
 * DELETE /fb/link
 * Huỷ liên kết Facebook của user đang login.
 */
export const unlink = api(
  { expose: true, auth: true, method: "DELETE", path: "/fb/link" },
  async (): Promise<UnlinkResponse> => {
    const auth = (getAuthData as () => AuthData | null)();
    if (!auth) throw APIError.unauthenticated("authentication required");

    const deleted = await db.queryRow<{ id: number; fb_psid: string }>`
      DELETE FROM fb_links WHERE user_id = ${auth.userID} RETURNING id, fb_psid
    `;

    if (!deleted) {
      throw APIError.notFound("No Facebook account is linked yet.");
    }

    // Invalidate cache
    await fbLinkCache.delete({ fbPsid: deleted.fb_psid });

    return { ok: true };
  },
);

import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import { getAuthData } from "~encore/auth";
import { db } from "./db";
import type { Member } from "../shared/contract";

// Cross-service read into the profile service's database.
const profileDb = SQLDatabase.named("profile");

interface AuthInfo {
  userID: string;
  email: string;
  role: string;
}

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
}

interface SyncResponse {
  ok: boolean;
  synced: number;
}

interface JoinResponse {
  ok: boolean;
  member: Member;
}

function memberName(row: ProfileRow): string {
  const name = (row.full_name ?? "").trim();
  if (name) return name;
  const email = (row.email ?? "").trim();
  return email ? email.split("@")[0] : row.user_id;
}

async function upsertMember(id: string, name: string, title: string): Promise<void> {
  await db.exec`
    INSERT INTO members (id, name, title, skills)
    VALUES (${id}, ${name}, ${title}, '[]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      title = EXCLUDED.title,
      updated_at = NOW()
  `;
}

/**
 * POST /members/sync
 * Import every profile into the shared board as a member.
 * Handy for seeding the board from existing users.
 */
export const syncMembers = api(
  { expose: true, auth: true, method: "POST", path: "/members/sync" },
  async (): Promise<SyncResponse> => {
    const rows = profileDb.query<ProfileRow>`
      SELECT user_id, full_name, email, role
      FROM profiles
      ORDER BY updated_at DESC
    `;

    let synced = 0;
    for await (const row of rows) {
      if (!row.user_id) continue;
      await upsertMember(row.user_id, memberName(row), (row.role ?? "").trim());
      synced++;
    }

    return { ok: true, synced };
  },
);

/**
 * POST /members/join
 * The logged-in user joins the shared board as a member.
 */
export const joinBoard = api(
  { expose: true, auth: true, method: "POST", path: "/members/join" },
  async (): Promise<JoinResponse> => {
    const auth = (getAuthData as () => AuthInfo | null)();
    if (!auth) throw APIError.unauthenticated("authentication required");

    const profile = await profileDb.queryRow<ProfileRow>`
      SELECT user_id, full_name, email, role
      FROM profiles
      WHERE user_id = ${auth.userID} OR id = ${auth.userID}
      LIMIT 1
    `;

    const name = profile ? memberName(profile) : auth.email.split("@")[0];
    const title = (profile?.role ?? "").trim();

    await upsertMember(auth.userID, name, title);

    return {
      ok: true,
      member: { id: auth.userID, name, title, skills: [], currentLoad: 0 },
    };
  },
);

import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import { getAuthData } from "~encore/auth";

const db = new SQLDatabase("profile", {
  migrations: "./migrations",
});

interface AuthInfo {
  userID: string;
  role: string;
}

export interface AvailabilitySlot {
  start?: string;
  end?: string;
  durationMinutes?: number;
}

export interface PlanningPreferences {
  preferredSessionLength?: 15 | 30 | 45 | 60;
  studyIntensity?: "light" | "balanced" | "intensive";
  preferredStudyTime?: "morning" | "afternoon" | "evening";
  reminderTime?: string;
}

export interface LinkedServices {
  messenger?: {
    connected: boolean;
    linkedAt?: string;
  };
}

export interface ProfileResponse {
  id: string;
  user_id: string;
  full_name: string;
  grade: string;
  subjects: string[];
  goals: string;
  weak_topics: string[];
  availability: Record<string, AvailabilitySlot[]>;
  exam_dates: Record<string, string>;
  target_scores: Record<string, number>;
  planning_preferences: PlanningPreferences;
  linked_services: LinkedServices;
  created_at: string;
  updated_at: string;
}

interface ProfileParams {
  id: string;
}

interface UpsertRequest {
  full_name?: string;
  fullName?: string;
  grade?: string;
  subjects: string[];
  goals?: string;
  goal?: string;
  study_goal?: string;
  weak_topics?: string[];
  weaknesses?: string[];
  availability: Record<string, AvailabilitySlot[] | number | string[]>;
  exam_dates?: Record<string, string>;
  target_scores?: Record<string, number>;
  planning_preferences?: PlanningPreferences;
  planningPreferences?: PlanningPreferences;
  linked_services?: LinkedServices;
  linkedServices?: LinkedServices;
}

interface ListProfilesResponse {
  profiles: ProfileResponse[];
  total: number;
}

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string;
  grade: string;
  subjects: unknown;
  goals: string | null;
  weak_topics: unknown;
  availability: unknown;
  exam_dates: unknown;
  target_scores: unknown;
  planning_preferences: unknown;
  linked_services: unknown;
  created_at: Date;
  updated_at: Date;
}

function currentUserID(): string {
  const auth = (getAuthData as () => AuthInfo | null)();
  if (!auth) throw APIError.unauthenticated("authentication required");
  return auth.userID;
}

function requireAdmin(): void {
  const auth = (getAuthData as () => AuthInfo | null)();
  if (!auth) throw APIError.unauthenticated("authentication required");
  if (auth.role !== "admin") throw APIError.permissionDenied("admin access required");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function objectRecord<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value as T;
}

function normalizeAvailability(
  availability: Record<string, AvailabilitySlot[] | number | string[]> | undefined,
): Record<string, AvailabilitySlot[]> {
  if (!availability || typeof availability !== "object") return {};

  const normalized: Record<string, AvailabilitySlot[]> = {};
  for (const [day, value] of Object.entries(availability)) {
    const key = day.trim().toLowerCase();
    if (!key) continue;

    if (typeof value === "number") {
      if (value > 0) normalized[key] = [{ durationMinutes: value }];
      continue;
    }

    if (!Array.isArray(value)) continue;
    const slots = value
      .map((slot) => {
        if (typeof slot === "string") return { durationMinutes: Number(slot) || undefined };
        return {
          start: slot.start,
          end: slot.end,
          durationMinutes: slot.durationMinutes,
        };
      })
      .filter((slot) => slot.start || slot.end || slot.durationMinutes);

    if (slots.length > 0) normalized[key] = slots;
  }
  return normalized;
}

function normalizeRequest(p: UpsertRequest): Omit<ProfileResponse, "id" | "user_id" | "created_at" | "updated_at"> {
  const subjects = stringArray(p.subjects);
  const availability = normalizeAvailability(p.availability);

  if (subjects.length === 0) {
    throw APIError.invalidArgument("subjects is required (at least 1 subject)");
  }
  if (Object.keys(availability).length === 0) {
    throw APIError.invalidArgument("availability is required (at least 1 day or time slot)");
  }

  return {
    full_name: p.full_name ?? p.fullName ?? "",
    grade: p.grade ?? "",
    subjects,
    goals: p.goals ?? p.goal ?? p.study_goal ?? "",
    weak_topics: stringArray(p.weak_topics ?? p.weaknesses),
    availability,
    exam_dates: objectRecord<Record<string, string>>(p.exam_dates, {}),
    target_scores: objectRecord<Record<string, number>>(p.target_scores, {}),
    planning_preferences: p.planning_preferences ?? p.planningPreferences ?? {},
    linked_services: p.linked_services ?? p.linkedServices ?? {},
  };
}

function ensureParsedJSON(value: unknown): unknown {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function toResponse(row: ProfileRow): ProfileResponse {
  return {
    id: row.id,
    user_id: row.user_id,
    full_name: row.full_name ?? "",
    grade: row.grade ?? "",
    subjects: stringArray(ensureParsedJSON(row.subjects)),
    goals: row.goals ?? "",
    weak_topics: stringArray(ensureParsedJSON(row.weak_topics)),
    availability: normalizeAvailability(
      objectRecord<Record<string, AvailabilitySlot[] | number | string[]>>(
        ensureParsedJSON(row.availability), {},
      ),
    ),
    exam_dates: objectRecord<Record<string, string>>(ensureParsedJSON(row.exam_dates), {}),
    target_scores: objectRecord<Record<string, number>>(ensureParsedJSON(row.target_scores), {}),
    planning_preferences: objectRecord<PlanningPreferences>(ensureParsedJSON(row.planning_preferences), {}),
    linked_services: objectRecord<LinkedServices>(ensureParsedJSON(row.linked_services), {}),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function loadProfileByUserID(userID: string): Promise<ProfileRow | null> {
  return db.queryRow<ProfileRow>`
    SELECT id, user_id, full_name, grade, subjects, goals, weak_topics, availability,
           exam_dates, target_scores, planning_preferences, linked_services,
           created_at, updated_at
    FROM profiles
    WHERE user_id = ${userID} OR id = ${userID}
    LIMIT 1
  `;
}

async function saveProfile(userID: string, p: UpsertRequest): Promise<ProfileResponse> {
  const profile = normalizeRequest(p);

  const row = await db.queryRow<ProfileRow>`
    INSERT INTO profiles (
      id, user_id, full_name, grade, subjects, goals, weak_topics, availability,
      exam_dates, target_scores, planning_preferences, linked_services
    )
    VALUES (
      ${userID}, ${userID}, ${profile.full_name}, ${profile.grade},
      ${JSON.stringify(profile.subjects)}::jsonb, ${profile.goals},
      ${JSON.stringify(profile.weak_topics)}::jsonb, ${JSON.stringify(profile.availability)}::jsonb,
      ${JSON.stringify(profile.exam_dates)}::jsonb, ${JSON.stringify(profile.target_scores)}::jsonb,
      ${JSON.stringify(profile.planning_preferences)}::jsonb, ${JSON.stringify(profile.linked_services)}::jsonb
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      grade = EXCLUDED.grade,
      subjects = EXCLUDED.subjects,
      goals = EXCLUDED.goals,
      weak_topics = EXCLUDED.weak_topics,
      availability = EXCLUDED.availability,
      exam_dates = EXCLUDED.exam_dates,
      target_scores = EXCLUDED.target_scores,
      planning_preferences = EXCLUDED.planning_preferences,
      linked_services = EXCLUDED.linked_services,
      updated_at = NOW()
    RETURNING id, user_id, full_name, grade, subjects, goals, weak_topics, availability,
              exam_dates, target_scores, planning_preferences, linked_services,
              created_at, updated_at
  `;

  if (!row) throw APIError.internal("failed to save profile");
  return toResponse(row);
}

export const getMine = api(
  { expose: true, auth: true, method: "GET", path: "/profile/me" },
  async (): Promise<ProfileResponse> => {
    const row = await loadProfileByUserID(currentUserID());
    if (!row) throw APIError.notFound("profile not found");
    return toResponse(row);
  },
);

export const createMine = api(
  { expose: true, auth: true, method: "POST", path: "/profile/me" },
  async (p: UpsertRequest): Promise<ProfileResponse> => saveProfile(currentUserID(), p),
);

export const updateMine = api(
  { expose: true, auth: true, method: "PUT", path: "/profile/me" },
  async (p: UpsertRequest): Promise<ProfileResponse> => saveProfile(currentUserID(), p),
);

export const adminList = api(
  { expose: true, auth: true, method: "GET", path: "/api/admin/profiles" },
  async (): Promise<ListProfilesResponse> => {
    requireAdmin();

    const rows = db.query<ProfileRow>`
      SELECT id, user_id, full_name, grade, subjects, goals, weak_topics, availability,
             exam_dates, target_scores, planning_preferences, linked_services,
             created_at, updated_at
      FROM profiles
      ORDER BY updated_at DESC
    `;
    const profiles: ProfileResponse[] = [];
    for await (const row of rows) profiles.push(toResponse(row));
    return { profiles, total: profiles.length };
  },
);

export const adminGet = api(
  { expose: true, auth: true, method: "GET", path: "/api/admin/profiles/:id" },
  async ({ id }: ProfileParams): Promise<ProfileResponse> => {
    requireAdmin();
    const row = await loadProfileByUserID(id);
    if (!row) throw APIError.notFound("profile not found");
    return toResponse(row);
  },
);

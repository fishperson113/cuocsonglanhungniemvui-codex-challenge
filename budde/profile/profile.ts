import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { SQLDatabase } from "encore.dev/storage/sqldb";

const db = new SQLDatabase("profile", {
  migrations: "./migrations",
});

interface AuthInfo {
  userID: string;
  email: string;
  role: string;
}

export interface ProfileResponse {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ProfileParams {
  id: string;
}

interface UpsertRequest {
  id?: string;
  name?: string;
  full_name?: string;
  fullName?: string;
  email?: string;
  role?: string;
  description?: string;
}

interface ListProfilesResponse {
  profiles: ProfileResponse[];
  total: number;
}

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

function toResponse(row: ProfileRow): ProfileResponse {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.full_name ?? "",
    email: row.email ?? "",
    role: row.role ?? "user",
    description: row.description ?? "",
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function loadProfileByID(id: string): Promise<ProfileRow | null> {
  return db.queryRow<ProfileRow>`
    SELECT id, user_id, full_name, email, role, description, created_at, updated_at
    FROM profiles
    WHERE user_id = ${id} OR id = ${id} OR email = ${id}
    LIMIT 1
  `;
}

async function saveProfile(p: UpsertRequest): Promise<ProfileResponse> {
  const auth = (getAuthData as () => AuthInfo | null)();
  if (!auth) throw APIError.unauthenticated("authentication required");

  const name = (p.name ?? p.full_name ?? p.fullName ?? "").trim();
  const email = (p.email ?? auth.email ?? "").trim().toLowerCase();
  const role = (p.role ?? "").trim();
  const description = (p.description ?? "").trim();

  if (!name) throw APIError.invalidArgument("name is required");
  if (!email) throw APIError.invalidArgument("email is required");
  if (!role) throw APIError.invalidArgument("title is required");
  if (!description) throw APIError.invalidArgument("description is required");

  const existing = await db.queryRow<{ id: string }>`
    SELECT id
    FROM profiles
    WHERE user_id = ${auth.userID} OR id = ${auth.userID} OR email = ${email}
    LIMIT 1
  `;
  const id = existing?.id ?? auth.userID;

  const row = await db.queryRow<ProfileRow>`
    INSERT INTO profiles (id, user_id, full_name, email, role, description, subjects, availability)
    VALUES (
      ${id}, ${auth.userID}, ${name}, ${email}, ${role}, ${description},
      '[]'::jsonb, '{}'::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      role = EXCLUDED.role,
      description = EXCLUDED.description,
      updated_at = NOW()
    RETURNING id, user_id, full_name, email, role, description, created_at, updated_at
  `;

  if (!row) throw APIError.internal("failed to save profile");
  return toResponse(row);
}

export const list = api(
  { expose: true, auth: true, method: "GET", path: "/profile" },
  async (): Promise<ListProfilesResponse> => {
    const rows = db.query<ProfileRow>`
      SELECT id, user_id, full_name, email, role, description, created_at, updated_at
      FROM profiles
      ORDER BY updated_at DESC
    `;
    const profiles: ProfileResponse[] = [];
    for await (const row of rows) profiles.push(toResponse(row));
    return { profiles, total: profiles.length };
  },
);

export const create = api(
  { expose: true, auth: true, method: "POST", path: "/profile" },
  async (p: UpsertRequest): Promise<ProfileResponse> => saveProfile(p),
);

export const get = api(
  { expose: true, auth: true, method: "GET", path: "/profile/:id" },
  async ({ id }: ProfileParams): Promise<ProfileResponse> => {
    const row = await loadProfileByID(id);
    if (!row) throw APIError.notFound("profile not found");
    return toResponse(row);
  },
);

export const update = api(
  { expose: true, auth: true, method: "PUT", path: "/profile/:id" },
  async ({ id, ...p }: ProfileParams & UpsertRequest): Promise<ProfileResponse> =>
    saveProfile({ ...p, id }),
);
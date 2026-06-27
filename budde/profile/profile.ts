import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";

const db = new SQLDatabase("profile", {
  migrations: "./migrations",
});

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
    WHERE user_id = ${id} OR id = ${id}
    LIMIT 1
  `;
}

async function saveProfile(p: UpsertRequest): Promise<ProfileResponse> {
  const name = (p.name ?? p.full_name ?? p.fullName ?? "").trim();
  const email = (p.email ?? "").trim();
  const role = (p.role ?? "user").trim();
  const description = (p.description ?? "").trim();
  const id = (p.id ?? email ?? "").trim();

  if (!name) throw APIError.invalidArgument("name is required");
  if (!id) throw APIError.invalidArgument("id or email is required");

  const row = await db.queryRow<ProfileRow>`
    INSERT INTO profiles (id, user_id, full_name, email, role, description, subjects, availability)
    VALUES (
      ${id}, ${id}, ${name}, ${email}, ${role}, ${description},
      '[]'::jsonb, '{}'::jsonb
    )
    ON CONFLICT (user_id) DO UPDATE SET
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
  { expose: true, method: "GET", path: "/profile" },
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
  { expose: true, method: "POST", path: "/profile" },
  async (p: UpsertRequest): Promise<ProfileResponse> => saveProfile(p),
);

export const get = api(
  { expose: true, method: "GET", path: "/profile/:id" },
  async ({ id }: ProfileParams): Promise<ProfileResponse> => {
    const row = await loadProfileByID(id);
    if (!row) throw APIError.notFound("profile not found");
    return toResponse(row);
  },
);

export const update = api(
  { expose: true, method: "PUT", path: "/profile/:id" },
  async ({ id, ...p }: ProfileParams & UpsertRequest): Promise<ProfileResponse> =>
    saveProfile({ ...p, id }),
);

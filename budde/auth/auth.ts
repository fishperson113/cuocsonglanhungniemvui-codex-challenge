import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import type { IncomingMessage } from "node:http";
import pg from "pg";
const { Pool } = pg;
import { secret } from "encore.dev/config";
import { db } from "./db";
import { unsignCookieValue } from "./handler";
import { userCache } from "./cache";

// ---- Better Auth Config ----

const authSecret = secret("AuthSecret");
const facebookClientId = secret("FacebookClientId");
const facebookClientSecret = secret("FacebookClientSecret");

const pool = new Pool({
  connectionString: db.connectionString,
});

const ngrokDomain = process.env.NGROK_DOMAIN ?? "";
const isNgrok = ngrokDomain.length > 0;
const authBaseURL = isNgrok
  ? `https://${ngrokDomain}/api/auth`
  : "http://localhost:4000/api/auth";
const fbRedirectURI = isNgrok
  ? `https://${ngrokDomain}/api/auth/callback/facebook`
  : "http://localhost:4000/api/auth/callback/facebook";

const trustedOrigins = [
  "http://localhost:4000",
  "http://localhost:3000",
];
if (isNgrok) trustedOrigins.push(`https://${ngrokDomain}`);

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: authBaseURL,
  basePath: "/api/auth",
  database: pool,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
  socialProviders: {
    facebook: {
      clientId: facebookClientId(),
      clientSecret: facebookClientSecret(),
      redirectURI: fbRedirectURI,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "user",
        input: true,
      },
      disabled: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },
});

// ---- Better Auth Routes (proxy to Node handler) ----

export const betterAuthRoutes = api.raw(
  { expose: true, path: "/api/auth/*path", method: "*" },
  toNodeHandler(auth),
);

// ---- OAuth Callback (reads session cookie after Facebook login) ----

const FRONTEND_URL = "http://localhost:3000";

export const oauthSuccess = api.raw(
  { expose: true, path: "/auth/oauth-success", method: "GET" },
  async (req, res) => {
    const cookies = (req.headers.cookie || "").split(";").map((c) => c.trim());
    let token: string | null = null;
    for (const c of cookies) {
      if (c.startsWith("better-auth.session_token=")) {
        token = decodeURIComponent(c.split("=").slice(1).join("="));
        break;
      }
    }

    if (!token) {
      res.writeHead(302, { Location: `${FRONTEND_URL}/studyos/login?error=oauth_failed` });
      res.end();
      return;
    }

    const rawToken = unsignCookieValue(token);
    if (!rawToken) {
      res.writeHead(302, { Location: `${FRONTEND_URL}/studyos/login?error=oauth_failed` });
      res.end();
      return;
    }

    const secure = isNgrok ? "; Secure" : "";
    res.writeHead(302, {
      Location: `${FRONTEND_URL}/studyos/login?token=${encodeURIComponent(rawToken)}&oauth=success`,
      "Set-Cookie": [
        `session_token=${encodeURIComponent(rawToken)}; Path=/; SameSite=Lax; Max-Age=300${secure}`,
        `better-auth.session_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`,
      ],
    });
    res.end();
  },
);

// ---- Types ----

export type Role = "admin" | "user";

export interface AuthData {
  userID: string;
  email: string;
  role: Role;
}

interface BetterUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  created_at: string;
  updated_at: string;
}

interface BetterAuthEmailResult {
  token?: string | null;
  user: {
    id: string;
    email: string;
    name?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
    role?: string;
    disabled?: boolean;
  };
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface SessionResponse {
  user: PublicUser;
}

export interface LogoutResponse {
  ok: true;
}

export interface RegisterParams {
  email: string;
  password: string;
  name?: string;
  role?: Role;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface UserIDParams {
  id: string;
}

export interface ListUsersResponse {
  users: PublicUser[];
}

export interface PatchRoleParams {
  id: string;
  role: Role;
}

// ---- Helpers ----

function toPublicUser(row: BetterUserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function requireSessionToken(result: BetterAuthEmailResult): string {
  if (!result.token) throw APIError.internal("failed to create session");
  return result.token;
}

function extractSessionTokenFromRequest(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (authorization) {
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }

  const cookieHeader = req.headers.cookie ?? "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith("better-auth.session_token=")) {
      return unsignCookieValue(cookie.split("=").slice(1).join("="));
    }
    if (cookie.startsWith("session_token=")) {
      return decodeURIComponent(cookie.split("=").slice(1).join("="));
    }
  }

  return null;
}

async function getUserById(id: string): Promise<BetterUserRow> {
  const row = await db.queryRow<BetterUserRow>`
    SELECT id, name, email, role, disabled,
      "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
    FROM "user"
    WHERE id = ${id}
  `;
  if (!row) throw APIError.notFound("user not found");
  return row;
}

async function currentUser(): Promise<BetterUserRow> {
  const data = (getAuthData as () => AuthData | null)();
  if (!data) throw APIError.unauthenticated("authentication required");

  const row = await db.queryRow<BetterUserRow>`
    SELECT id, name, email, role, disabled,
      "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
    FROM "user"
    WHERE id = ${data.userID}
  `;
  if (!row || row.disabled) throw APIError.unauthenticated("authentication required");
  return row;
}

async function requireAdmin(): Promise<BetterUserRow> {
  const user = await currentUser();
  if (user.role !== "admin") throw APIError.permissionDenied("admin access required");
  return user;
}

// ---- Auth Endpoints (Better Auth wrappers) ----

export const register = api(
  { expose: true, method: "POST", path: "/auth/register", sensitive: true },
  async (p: RegisterParams): Promise<AuthResponse> => {
    const email = p.email.trim().toLowerCase();
    const password = p.password;
    const role = p.role ?? "user";
    const name = p.name?.trim() || email.split("@")[0];

    if (!email) throw APIError.invalidArgument("email is required");
    if (password.length < 6) throw APIError.invalidArgument("password must be at least 6 characters");
    if (role !== "admin" && role !== "user") throw APIError.invalidArgument("invalid role");

    if (role === "admin") {
      const existing = await db.queryRow<{ id: string }>`
        SELECT id FROM "user" WHERE role = 'admin' AND disabled = FALSE LIMIT 1
      `;
      if (existing) throw APIError.alreadyExists("admin account already exists");
    }

    let result: BetterAuthEmailResult;
    try {
      result = await auth.api.signUpEmail({
        body: { email, password, name, role },
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("already exists") || msg.includes("already used")) {
        throw APIError.alreadyExists("email already exists");
      }
      throw err;
    }

    // Set custom fields after Better Auth creates the user
    if (role !== "user") {
      await db.exec`UPDATE "user" SET role = ${role} WHERE id = ${result.user.id}`;
    }

    // If autoSignIn didn't produce a token, explicitly sign in
    let token = result.token ?? null;
    if (!token) {
      const sessionResult: BetterAuthEmailResult = await auth.api.signInEmail({
        body: { email, password },
      });
      token = sessionResult.token ?? null;
    }

    const user = await getUserById(result.user.id);

    return {
      token: requireSessionToken({ ...result, token }),
      user: toPublicUser(user),
    };
  },
);

export const login = api(
  { expose: true, method: "POST", path: "/auth/login", sensitive: true },
  async (p: LoginParams): Promise<AuthResponse> => {
    const email = p.email.trim().toLowerCase();

    let result: BetterAuthEmailResult;
    try {
      result = await auth.api.signInEmail({
        body: { email, password: p.password },
      });
    } catch {
      throw APIError.unauthenticated("invalid email or password");
    }

    const user = await getUserById(result.user.id);
    if (user.disabled) throw APIError.unauthenticated("invalid email or password");

    return {
      token: requireSessionToken(result),
      user: toPublicUser(user),
    };
  },
);

export const session = api(
  { expose: true, auth: true, method: "GET", path: "/auth/session" },
  async (): Promise<SessionResponse> => ({
    user: toPublicUser(await currentUser()),
  }),
);

export const logout = api.raw(
  { expose: true, method: "POST", path: "/auth/logout" },
  async (req, res) => {
    const token = extractSessionTokenFromRequest(req);
    if (token) {
      await db.exec`DELETE FROM "session" WHERE "token" = ${token}`;
    }

    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        `better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
        `session_token=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
      ],
    });
    res.end(JSON.stringify({ ok: true } satisfies LogoutResponse));
  },
);

// ---- User Endpoints ----

export const me = api(
  { expose: true, auth: true, method: "GET", path: "/users/me" },
  async (): Promise<PublicUser> => toPublicUser(await currentUser()),
);

export const list = api(
  { expose: true, auth: true, method: "GET", path: "/users" },
  async (): Promise<ListUsersResponse> => {
    await requireAdmin();

    const rows = db.query<BetterUserRow>`
      SELECT id, name, email, role, disabled,
        "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
      FROM "user"
      ORDER BY "createdAt" DESC, id DESC
    `;
    const users: PublicUser[] = [];
    for await (const row of rows) users.push(toPublicUser(row));
    return { users };
  },
);

export const get = api(
  { expose: true, auth: true, method: "GET", path: "/users/:id" },
  async ({ id }: UserIDParams): Promise<PublicUser> => {
    await requireAdmin();

    const row = await db.queryRow<BetterUserRow>`
      SELECT id, name, email, role, disabled,
        "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
      FROM "user"
      WHERE id = ${id}
    `;
    if (!row) throw APIError.notFound("user not found");
    return toPublicUser(row);
  },
);

export const patchRole = api(
  { expose: true, auth: true, method: "PATCH", path: "/users/:id/role" },
  async ({ id, role }: PatchRoleParams): Promise<PublicUser> => {
    const admin = await requireAdmin();

    if (role !== "admin" && role !== "user") throw APIError.invalidArgument("invalid role");
    if (admin.id === id && role !== "admin") {
      throw APIError.invalidArgument("admin cannot remove own admin role");
    }

    const user = await db.queryRow<BetterUserRow>`
      SELECT id, name, email, role, disabled,
        "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
      FROM "user"
      WHERE id = ${id}
    `;
    if (!user) throw APIError.notFound("user not found");

    if (role === "admin" && user.role !== "admin") {
      const existing = await db.queryRow<{ id: string }>`
        SELECT id FROM "user" WHERE role = 'admin' AND disabled = FALSE LIMIT 1
      `;
      if (existing) throw APIError.alreadyExists("admin account already exists");
    }

    const row = await db.queryRow<BetterUserRow>`
      UPDATE "user"
      SET role = ${role}, "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING id, name, email, role, disabled,
        "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
    `;
    await userCache.delete({ userId: id });
    return toPublicUser(row!);
  },
);

export const disable = api(
  { expose: true, auth: true, method: "DELETE", path: "/users/:id" },
  async ({ id }: UserIDParams): Promise<PublicUser> => {
    const admin = await requireAdmin();
    if (admin.id === id) throw APIError.invalidArgument("admin cannot disable own account");

    const row = await db.queryRow<BetterUserRow>`
      UPDATE "user"
      SET disabled = TRUE, "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING id, name, email, role, disabled,
        "createdAt"::text AS created_at, "updatedAt"::text AS updated_at
    `;
    if (!row) throw APIError.notFound("user not found");

    // Revoke all active sessions
    await db.exec`DELETE FROM "session" WHERE "userId" = ${id}`;

    // Invalidate cache
    await userCache.delete({ userId: id });

    return toPublicUser(row);
  },
);

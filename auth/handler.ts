import { APIError, Gateway, Header } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";
import { secret } from "encore.dev/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { fbLinkCache, userCache } from "./cache";

interface AuthParams {
  authorization?: Header<"Authorization">;
  cookie?: Header<"Cookie">;
  /** Messenger PSID for n8n API calls without a browser session token. */
  fbPsid?: Header<"X-FB-PSID">;
  /** Shared secret from n8n, required when using X-FB-PSID auth. */
  n8nSecret?: Header<"X-N8N-Secret">;
}

export interface AuthData {
  userID: string;
  email: string;
  role: string;
}

const authSecret = secret("AuthSecret");
const n8nSecret = secret("N8nSecret");

function extractBearerToken(authorization: string): string {
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

export function unsignCookieValue(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    const signatureStart = decoded.lastIndexOf(".");
    if (signatureStart < 1) return decoded;

    const token = decoded.slice(0, signatureStart);
    const signature = decoded.slice(signatureStart + 1);
    const expected = createHmac("sha256", authSecret()).update(token).digest("base64");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (actualBuffer.length !== expectedBuffer.length) return null;
    return timingSafeEqual(actualBuffer, expectedBuffer) ? token : null;
  } catch {
    return null;
  }
}

export const handler = authHandler<AuthParams, AuthData>(async (params) => {
  // 1. Bearer token (frontend localStorage flow): look up session directly.
  if (params.authorization) {
    const token = extractBearerToken(params.authorization);
    if (token) {
      const session = await db.queryRow<{ userId: string }>`
        SELECT "userId" FROM "session" WHERE "token" = ${token} AND "expiresAt" > NOW()
      `;
      if (session) {
        const user = await db.queryRow<{ id: string; email: string; role: string; disabled: boolean }>`
          SELECT id, email, role, disabled FROM "user" WHERE id = ${session.userId}
        `;
        if (user && !user.disabled) {
          return { userID: user.id, email: user.email, role: user.role };
        }
      }
    }
  }

  // 2. Signed cookie (OAuth/browser flows where Better Auth set the cookie).
  if (params.cookie) {
    const match = params.cookie.match(/better-auth\.session_token=([^;]+)/);
    const token = match ? unsignCookieValue(match[1]) : null;
    if (token) {
      const session = await db.queryRow<{ userId: string }>`
        SELECT "userId" FROM "session" WHERE "token" = ${token} AND "expiresAt" > NOW()
      `;
      if (session) {
        const user = await db.queryRow<{ id: string; email: string; role: string; disabled: boolean }>`
          SELECT id, email, role, disabled FROM "user" WHERE id = ${session.userId}
        `;
        if (user && !user.disabled) {
          return { userID: user.id, email: user.email, role: user.role };
        }
      }
    }
  }

  // 3. n8n: resolve user from Messenger PSID (requires shared secret).
  if (params.fbPsid) {
    if (!params.n8nSecret || params.n8nSecret !== n8nSecret()) {
      throw APIError.unauthenticated("invalid n8n secret");
    }

    let linkUserId = await fbLinkCache.get({ fbPsid: params.fbPsid });
    if (linkUserId === undefined) {
      const row = await db.queryRow<{ user_id: string }>`
        SELECT user_id FROM fb_links WHERE fb_psid = ${params.fbPsid}
      `;
      if (!row?.user_id) throw APIError.unauthenticated("facebook account not linked");
      linkUserId = row.user_id;
      await fbLinkCache.set({ fbPsid: params.fbPsid }, linkUserId);
    }

    let cachedUser = await userCache.get({ userId: linkUserId });
    if (!cachedUser) {
      const user = await db.queryRow<{ id: string; email: string; role: string }>`
        SELECT id, email, role FROM "user" WHERE id = ${linkUserId}
      `;
      if (!user) throw APIError.unauthenticated("linked user not found");
      cachedUser = user;
      await userCache.set({ userId: linkUserId }, user);
    }

    return {
      userID: cachedUser.id,
      email: cachedUser.email,
      role: cachedUser.role,
    };
  }

  throw APIError.unauthenticated("authentication required");
});

export const gateway = new Gateway({ authHandler: handler });

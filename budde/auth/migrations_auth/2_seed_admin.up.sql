-- Seed default admin: admin@c2app.edu.vn / Admin@123
-- Password is bcrypt-hashed. The account uses providerId = "email"
-- so Better Auth recognises it as an email/password credential.

-- Defensive: ensure custom columns exist even if the "user" table was
-- created by an older schema before role/disabled were added.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "disabled", "createdAt", "updatedAt")
VALUES (
  'admin-default-0001',
  'Admin',
  'admin@c2app.edu.vn',
  TRUE,
  'admin',
  FALSE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("email") DO NOTHING;

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
VALUES (
  'admin-account-default-0001',
  'admin@c2app.edu.vn',
  'email',
  'admin-default-0001',
  '$2b$10$e1ATOGNnxBh0Cdac3tAxjOpVPe7pX8rqmhQ1xj27eOedQ42AJiZku',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

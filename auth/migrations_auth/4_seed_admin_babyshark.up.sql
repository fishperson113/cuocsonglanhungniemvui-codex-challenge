-- Seed admin: admin@babyshark.vn / Admin@123
-- Đúng chuẩn Better Auth (khác seed cũ ở migration 2 vốn sai providerId + dùng bcrypt):
--   • providerId = 'credential'  (login email/password tra theo đúng giá trị này)
--   • accountId  = userId        (đúng convention better-auth cho credential)
--   • password   = scrypt hash dạng "saltHex:keyHex" sinh bằng better-auth hashPassword("Admin@123")

INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "disabled", "createdAt", "updatedAt")
VALUES (
  'admin-babyshark-0001',
  'Admin',
  'admin@babyshark.vn',
  TRUE,
  'admin',
  FALSE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("email") DO NOTHING;

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
VALUES (
  'admin-babyshark-acct-0001',
  'admin-babyshark-0001',
  'credential',
  'admin-babyshark-0001',
  '081c514e4d5be1e5af275076978b373e:0aa2905177bf3d0761b41b514258ad4e70cea6971a9dbfdc0182d1faa2de9839594c0817b6f4f3e7e1456f2613d160855e7ad1ee9d86ce2d17320921ad2cfaef',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

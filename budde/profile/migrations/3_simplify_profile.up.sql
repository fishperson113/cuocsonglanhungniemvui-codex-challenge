-- profile/migrations/3_simplify_profile.up.sql
-- Simplify profile to: name, email, role, description.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

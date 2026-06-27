ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS grade TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS goals TEXT,
  ADD COLUMN IF NOT EXISTS weak_topics JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS exam_dates JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_scores JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS planning_preferences JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS linked_services JSONB NOT NULL DEFAULT '{}';

UPDATE profiles
SET user_id = id
WHERE user_id IS NULL;

UPDATE profiles
SET goals = goal
WHERE goals IS NULL AND goal IS NOT NULL;

UPDATE profiles
SET weak_topics = to_jsonb(weaknesses)
WHERE weak_topics = '[]'::jsonb
  AND weaknesses IS NOT NULL
  AND array_length(weaknesses, 1) IS NOT NULL;

ALTER TABLE profiles
  ALTER COLUMN user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique ON profiles(user_id);

ALTER TABLE profiles
  ALTER COLUMN subjects DROP DEFAULT;

ALTER TABLE profiles
  ALTER COLUMN subjects TYPE JSONB USING to_jsonb(subjects);

ALTER TABLE profiles
  ALTER COLUMN subjects SET DEFAULT '[]'::jsonb;

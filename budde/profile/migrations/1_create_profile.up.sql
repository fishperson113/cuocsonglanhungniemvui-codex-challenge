-- profile/migrations/1_create_profile.up.sql

CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    subjects TEXT[] NOT NULL DEFAULT '{}',
    goal TEXT NOT NULL DEFAULT '',
    weaknesses TEXT[] NOT NULL DEFAULT '{}',
    availability JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

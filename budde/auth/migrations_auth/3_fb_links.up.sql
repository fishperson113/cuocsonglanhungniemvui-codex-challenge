-- auth/migrations/3_fb_links.up.sql

-- FB PSID ↔ BabyShark user mapping
CREATE TABLE IF NOT EXISTS fb_links (
    id BIGSERIAL PRIMARY KEY,
    fb_psid TEXT NOT NULL UNIQUE,
    unique_code TEXT NOT NULL UNIQUE,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fb_links_code ON fb_links(unique_code);
CREATE INDEX IF NOT EXISTS idx_fb_links_user ON fb_links(user_id);

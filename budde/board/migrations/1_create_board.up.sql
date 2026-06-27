CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  assignee_id TEXT NULL,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  artifact_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks (assignee_id);

INSERT INTO members (id, name, title, skills)
VALUES
  ('m1', 'An', 'Content Writer', '["blog", "copywriting", "content"]'::jsonb),
  ('m2', 'Binh', 'SEO', '["seo", "keyword research", "blog"]'::jsonb),
  ('m3', 'Chi', 'Performance Ads', '["facebook ads", "ab testing", "analytics"]'::jsonb),
  ('m4', 'Dung', 'Designer', '["banner", "visual design", "campaign"]'::jsonb),
  ('m5', 'Em', 'Sales Rep', '["lead outreach", "sales", "crm"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  skills = EXCLUDED.skills,
  updated_at = NOW();

INSERT INTO tasks (id, title, description, status, assignee_id, labels, priority, artifact_url)
VALUES
  (1, 'Viet blog SEO ve tinh nang moi', 'Create a search-friendly blog article introducing the newest product capability.', 'todo', NULL, '["SEO", "Content"]'::jsonb, 2, NULL),
  (2, 'Thiet ke banner campaign Tet', 'Design campaign banners for the Tet promotion across social and landing pages.', 'todo', NULL, '["Design", "Campaign"]'::jsonb, 2, NULL),
  (3, 'Chay A/B test Facebook Ads', 'Launch and monitor an A/B test for two Facebook Ads creatives.', 'todo', NULL, '["Ads", "Experiment"]'::jsonb, 1, NULL),
  (4, 'Goi 20 lead nong tuan nay', 'Call twenty warm leads and update CRM notes by end of week.', 'todo', NULL, '["Sales", "CRM"]'::jsonb, 1, NULL),
  (5, 'Lam report tong ket hieu qua marketing tuan', 'Prepare a weekly marketing performance report with highlights and recommendations.', 'todo', NULL, '["Report", "AI"]'::jsonb, 2, NULL),
  (6, 'Soan slide pitch cho khach hang Y', 'Draft a concise pitch deck for customer Y using the current campaign story.', 'todo', NULL, '["Slides", "AI"]'::jsonb, 2, NULL)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  labels = EXCLUDED.labels,
  priority = EXCLUDED.priority,
  updated_at = NOW();

SELECT setval('tasks_id_seq', GREATEST((SELECT MAX(id) FROM tasks), 1), true);

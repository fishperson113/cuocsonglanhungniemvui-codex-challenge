import { api, APIError } from "encore.dev/api";
import type { Query } from "encore.dev/api";
import { db } from "./db";
import type { KanbanTask, Member, TaskStatus } from "../shared/contract";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done"];
const AI_ASSIGNEE_ID = "ai-agent";

interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: string | null;
  labels: unknown;
  priority: number;
  artifact_url: string | null;
}

interface MemberRow {
  id: string;
  name: string;
  title: string;
  skills: unknown;
  current_load: number;
}

interface ListTasksRequest {
  status?: Query<TaskStatus>;
}

interface ListTasksResponse {
  tasks: KanbanTask[];
}

interface ListMembersResponse {
  members: Member[];
}

interface CreateTaskRequest {
  title: string;
  description?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  labels?: string[];
  priority?: number;
  artifactUrl?: string | null;
}

interface UpdateTaskRequest {
  id: number;
  title?: string;
  description?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  labels?: string[];
  priority?: number;
  artifactUrl?: string | null;
}

interface AssignTaskRequest {
  id: number;
  memberId: string;
}

interface ClaimTaskRequest {
  id: number;
}

interface AttachArtifactRequest {
  id: number;
  url: string;
  status?: TaskStatus;
}

interface WriteResponse {
  ok: boolean;
  task?: KanbanTask;
}

function parseStringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJSON(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => String(item).trim()).filter(Boolean);
}

function safeJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeLabels(labels: string[] | undefined): string[] {
  if (!labels) return [];
  return labels.map((label) => label.trim()).filter(Boolean);
}

function normalizePriority(priority: number | undefined): number {
  if (priority === undefined) return 2;
  if (!Number.isInteger(priority) || priority < 1 || priority > 3) {
    throw APIError.invalidArgument("priority must be an integer between 1 and 3");
  }
  return priority;
}

function normalizeStatus(status: TaskStatus | undefined, fallback: TaskStatus): TaskStatus {
  const next = status ?? fallback;
  if (!STATUSES.includes(next)) throw APIError.invalidArgument("invalid task status");
  return next;
}

function toTask(row: TaskRow): KanbanTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeId: row.assignee_id,
    labels: parseStringArray(row.labels),
    priority: row.priority,
    artifactUrl: row.artifact_url,
  };
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    skills: parseStringArray(row.skills),
    currentLoad: Number(row.current_load) || 0,
  };
}

async function getTaskById(id: number): Promise<KanbanTask> {
  const row = await db.queryRow<TaskRow>`
    SELECT id, title, description, status, assignee_id, labels, priority, artifact_url
    FROM tasks
    WHERE id = ${id}
  `;
  if (!row) throw APIError.notFound("task not found");
  return toTask(row);
}

export const listTasks = api<ListTasksRequest, ListTasksResponse>(
  { expose: true, auth: true, method: "GET", path: "/tasks" },
  async ({ status }) => {
    if (status && !STATUSES.includes(status)) throw APIError.invalidArgument("invalid task status");

    const tasks: KanbanTask[] = [];
    const rows = status
      ? db.query<TaskRow>`
          SELECT id, title, description, status, assignee_id, labels, priority, artifact_url
          FROM tasks
          WHERE status = ${status}
          ORDER BY id ASC
        `
      : db.query<TaskRow>`
          SELECT id, title, description, status, assignee_id, labels, priority, artifact_url
          FROM tasks
          ORDER BY
            CASE status
              WHEN 'todo' THEN 1
              WHEN 'in_progress' THEN 2
              WHEN 'review' THEN 3
              WHEN 'done' THEN 4
              ELSE 5
            END,
            id ASC
        `;

    for await (const row of rows) tasks.push(toTask(row));
    return { tasks };
  },
);

export const listMembers = api<void, ListMembersResponse>(
  { expose: true, auth: true, method: "GET", path: "/members" },
  async () => {
    const members: Member[] = [];
    const rows = db.query<MemberRow>`
      SELECT
        m.id,
        m.name,
        m.title,
        m.skills,
        COUNT(t.id)::int AS current_load
      FROM members m
      LEFT JOIN tasks t
        ON t.assignee_id = m.id
       AND t.status IN ('in_progress', 'review')
      GROUP BY m.id, m.name, m.title, m.skills
      ORDER BY m.id ASC
    `;

    for await (const row of rows) members.push(toMember(row));
    return { members };
  },
);

export const createTask = api<CreateTaskRequest, KanbanTask>(
  { expose: true, auth: true, method: "POST", path: "/tasks" },
  async (req) => {
    const title = req.title.trim();
    if (!title) throw APIError.invalidArgument("title is required");

    const description = req.description?.trim() ?? "";
    const status = normalizeStatus(req.status, "todo");
    const labels = normalizeLabels(req.labels);
    const priority = normalizePriority(req.priority);

    const row = await db.queryRow<TaskRow>`
      INSERT INTO tasks (title, description, status, assignee_id, labels, priority, artifact_url)
      VALUES (
        ${title},
        ${description},
        ${status},
        ${req.assigneeId ?? null},
        ${JSON.stringify(labels)}::jsonb,
        ${priority},
        ${req.artifactUrl ?? null}
      )
      RETURNING id, title, description, status, assignee_id, labels, priority, artifact_url
    `;
    if (!row) throw APIError.internal("failed to create task");
    return toTask(row);
  },
);

export const updateTask = api<UpdateTaskRequest, KanbanTask>(
  { expose: true, auth: true, method: "PATCH", path: "/tasks/:id" },
  async (req) => {
    const existing = await getTaskById(req.id);
    const title = req.title === undefined ? existing.title : req.title.trim();
    if (!title) throw APIError.invalidArgument("title is required");

    const description = req.description === undefined ? existing.description : req.description.trim();
    const status = normalizeStatus(req.status, existing.status);
    const labels = req.labels === undefined ? existing.labels : normalizeLabels(req.labels);
    const priority = normalizePriority(req.priority ?? existing.priority);
    const assigneeId = req.assigneeId === undefined ? existing.assigneeId : req.assigneeId;
    const artifactUrl = req.artifactUrl === undefined ? existing.artifactUrl : req.artifactUrl;

    const row = await db.queryRow<TaskRow>`
      UPDATE tasks
      SET title = ${title},
          description = ${description},
          status = ${status},
          assignee_id = ${assigneeId},
          labels = ${JSON.stringify(labels)}::jsonb,
          priority = ${priority},
          artifact_url = ${artifactUrl},
          updated_at = NOW()
      WHERE id = ${req.id}
      RETURNING id, title, description, status, assignee_id, labels, priority, artifact_url
    `;
    if (!row) throw APIError.notFound("task not found");
    return toTask(row);
  },
);

export const assignTask = api<AssignTaskRequest, WriteResponse>(
  { expose: true, auth: true, method: "PATCH", path: "/tasks/:id/assign" },
  async ({ id, memberId }) => {
    const row = await db.queryRow<TaskRow>`
      UPDATE tasks
      SET assignee_id = ${memberId},
          status = 'in_progress',
          updated_at = NOW()
      WHERE id = ${id}
        AND status = 'todo'
      RETURNING id, title, description, status, assignee_id, labels, priority, artifact_url
    `;
    return row ? { ok: true, task: toTask(row) } : { ok: false };
  },
);

export const claimTask = api<ClaimTaskRequest, WriteResponse>(
  { expose: true, method: "PATCH", path: "/tasks/:id/claim" },
  async ({ id }) => {
    const row = await db.queryRow<TaskRow>`
      UPDATE tasks
      SET assignee_id = ${AI_ASSIGNEE_ID},
          status = 'in_progress',
          updated_at = NOW()
      WHERE id = ${id}
        AND status = 'todo'
      RETURNING id, title, description, status, assignee_id, labels, priority, artifact_url
    `;
    return row ? { ok: true, task: toTask(row) } : { ok: false };
  },
);

export const attachArtifact = api<AttachArtifactRequest, KanbanTask>(
  { expose: true, method: "PATCH", path: "/tasks/:id/artifact" },
  async ({ id, url, status }) => {
    const artifactUrl = url.trim();
    if (!artifactUrl) throw APIError.invalidArgument("url is required");
    const nextStatus = normalizeStatus(status, "review");

    const row = await db.queryRow<TaskRow>`
      UPDATE tasks
      SET artifact_url = ${artifactUrl},
          status = ${nextStatus},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, description, status, assignee_id, labels, priority, artifact_url
    `;
    if (!row) throw APIError.notFound("task not found");
    return toTask(row);
  },
);

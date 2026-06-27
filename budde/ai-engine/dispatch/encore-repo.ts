/**
 * EncoreRepo — implement DispatchRepository bằng cách truy cập THẲNG database `board`
 * qua SQLDatabase.named("board") (cùng pattern board/membership.ts đọc DB "profile").
 *
 * Lý do không gọi qua ~encore/clients: các endpoint board (listTasks/assign...) đã bật
 * `auth: true`, mà agent là backend trusted chạy nền (không có user token). Đọc/ghi DB
 * trực tiếp vừa bỏ qua auth gateway, vừa giữ nguyên logic atomic (UPDATE ... WHERE status='todo').
 *
 * Chỉ import được dưới Encore runtime (không chạy bằng `node` trực tiếp).
 */
import { SQLDatabase } from "encore.dev/storage/sqldb";
import type { DispatchRepository, KanbanTask, Member, TaskStatus } from "./contract.ts";

const boardDb = SQLDatabase.named("board");

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

export const encoreRepo: DispatchRepository = {
  getTodoTasks: async () => {
    const tasks: KanbanTask[] = [];
    const rows = boardDb.query<TaskRow>`
      SELECT id, title, description, status, assignee_id, labels, priority, artifact_url
      FROM tasks
      WHERE status = 'todo'
      ORDER BY id ASC
    `;
    for await (const row of rows) tasks.push(toTask(row));
    return tasks;
  },

  getMembers: async () => {
    const members: Member[] = [];
    const rows = boardDb.query<MemberRow>`
      SELECT
        m.id, m.name, m.title, m.skills,
        COUNT(t.id)::int AS current_load
      FROM members m
      LEFT JOIN tasks t
        ON t.assignee_id = m.id
       AND t.status IN ('in_progress', 'review')
      GROUP BY m.id, m.name, m.title, m.skills
      ORDER BY m.id ASC
    `;
    for await (const row of rows) members.push(toMember(row));
    return members;
  },

  assignTask: async (taskId, assigneeId) => {
    // Atomic: chỉ gán khi còn 'todo'.
    const row = await boardDb.queryRow<{ id: number }>`
      UPDATE tasks
      SET assignee_id = ${assigneeId}, status = 'in_progress', updated_at = NOW()
      WHERE id = ${taskId} AND status = 'todo'
      RETURNING id
    `;
    return !!row;
  },

  claimTask: async (taskId) => {
    const row = await boardDb.queryRow<{ id: number }>`
      UPDATE tasks
      SET assignee_id = ${AI_ASSIGNEE_ID}, status = 'in_progress', updated_at = NOW()
      WHERE id = ${taskId} AND status = 'todo'
      RETURNING id
    `;
    return !!row;
  },

  attachArtifact: async (taskId, url, status) => {
    const nextStatus: TaskStatus = status ?? "review";
    await boardDb.exec`
      UPDATE tasks
      SET artifact_url = ${url}, status = ${nextStatus}, updated_at = NOW()
      WHERE id = ${taskId}
    `;
  },
};

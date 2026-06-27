"use client";

import { getToken } from "./auth";

export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface KanbanTask {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  labels: string[];
  priority: number;
  artifactUrl: string | null;
}

export interface Member {
  id: string;
  name: string;
  title: string;
  skills: string[];
  currentLoad: number;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.message ?? `HTTP ${res.status}`;
}

export async function listTasks(): Promise<KanbanTask[]> {
  const res = await fetch("/tasks", { headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  const data: { tasks: KanbanTask[] } = await res.json();
  return data.tasks ?? [];
}

export async function listMembers(): Promise<Member[]> {
  const res = await fetch("/members", { headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  const data: { members: Member[] } = await res.json();
  return data.members ?? [];
}

/** Logged-in user joins the shared board as a member. */
export async function joinBoard(): Promise<Member> {
  const res = await fetch("/members/join", {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data: { member: Member } = await res.json();
  return data.member;
}

/** Import all profiles into the board as members (demo/seed helper). */
export async function syncMembers(): Promise<number> {
  const res = await fetch("/members/sync", { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  const data: { synced: number } = await res.json();
  return data.synced;
}

export async function assignTask(id: number, memberId: string): Promise<boolean> {
  const res = await fetch(`/tasks/${id}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ memberId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data: { ok: boolean } = await res.json();
  return data.ok;
}

export async function updateTaskStatus(id: number, status: TaskStatus): Promise<void> {
  const res = await fetch(`/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ id, status }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function createTask(
  title: string,
  description: string,
  assigneeId?: string,
): Promise<KanbanTask> {
  const res = await fetch("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      title,
      description,
      ...(assigneeId ? { assigneeId, status: "in_progress" } : {}),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<KanbanTask>;
}

// ── AI Dispatch (chạy nền + polling) ────────────────────────────────
export interface DispatchJob {
  id: string;
  status: "running" | "done" | "error";
  logs: string[];
  summary?: string;
  error?: string;
}

/** Bấm "Start": kích hoạt agent điều phối chạy nền, trả jobId để poll. */
export async function startDispatch(): Promise<string> {
  const res = await fetch("/dispatch/start", { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  const data: { jobId: string } = await res.json();
  return data.jobId;
}

/** Poll trạng thái 1 job dispatch (logs + status + summary). */
export async function getDispatchStatus(jobId: string): Promise<DispatchJob> {
  const res = await fetch(`/dispatch/status/${jobId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<DispatchJob>;
}

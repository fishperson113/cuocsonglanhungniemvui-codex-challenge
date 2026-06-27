"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  EyeIcon,
  LinkIcon,
  PlusIcon,
  UserPlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { fetchSession, getToken, logout, type User } from "../lib/auth";
import NavTabs from "../components/NavTabs";
import {
  assignTask,
  createTask,
  getDispatchStatus,
  joinBoard,
  listMembers,
  listTasks,
  startDispatch,
  updateTaskStatus,
  type KanbanTask,
  type Member,
  type TaskStatus,
} from "../lib/board";

interface BoardProfile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  description: string;
}

interface ListProfilesResponse {
  profiles: BoardProfile[];
}

const COLUMNS: { status: TaskStatus; label: string; accent: string }[] = [
  { status: "todo", label: "To Do", accent: "from-slate-500 to-slate-600" },
  { status: "in_progress", label: "In Progress", accent: "from-indigo-500 to-blue-600" },
  { status: "review", label: "Review", accent: "from-amber-500 to-orange-600" },
  { status: "done", label: "Done", accent: "from-emerald-500 to-green-600" },
];

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: "in_progress",
  in_progress: "review",
  review: "done",
  done: null,
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";

function avatarColor(seed: string): string {
  const colors = [
    "from-fuchsia-500 to-pink-600",
    "from-indigo-500 to-blue-600",
    "from-cyan-500 to-teal-600",
    "from-amber-500 to-orange-600",
    "from-emerald-500 to-green-600",
    "from-violet-500 to-purple-600",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isCompleteUserProfile(profile: BoardProfile | null | undefined): boolean {
  return Boolean(
    profile &&
      profile.name.trim() &&
      profile.email.trim() &&
      profile.role.trim() &&
      profile.description.trim(),
  );
}

function belongsToUser(profile: BoardProfile, user: User): boolean {
  return (
    profile.user_id === user.id ||
    profile.id === user.id ||
    profile.email.trim().toLowerCase() === user.email.trim().toLowerCase()
  );
}

export default function BoardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [hasCompleteProfile, setHasCompleteProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchLogs, setDispatchLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [savingTaskIds, setSavingTaskIds] = useState<number[]>([]);

  const membersById = useMemo(() => {
    return new Map(members.map((member) => [member.id, member]));
  }, [members]);

  const load = useCallback(async () => {
    const [loadedTasks, loadedMembers] = await Promise.all([listTasks(), listMembers()]);
    setTasks(loadedTasks);
    setMembers(loadedMembers);
  }, []);

  const loadProfileStatus = useCallback(async (sessionUser: User): Promise<boolean> => {
    try {
      const res = await fetch("/profile", {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) return false;
      const data: ListProfilesResponse = await res.json();
      const profile = data.profiles?.find((item) => belongsToUser(item, sessionUser));
      return isCompleteUserProfile(profile);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    fetchSession()
      .then(async (sessionUser) => {
        if (!active) return;
        if (!sessionUser) {
          router.replace("/login");
          return;
        }
        setUser(sessionUser);
        setHasCompleteProfile(await loadProfileStatus(sessionUser));
        setAuthChecked(true);
        await load();
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setAuthChecked(true);
      });

    return () => {
      active = false;
    };
  }, [load, loadProfileStatus, router]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function moveTask(taskId: number, status: TaskStatus) {
    if (!isMember) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status || savingTaskIds.includes(taskId)) return;

    const previousStatus = task.status;
    setError(null);
    setSavingTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
    setTasks((current) =>
      current.map((item) => (item.id === taskId ? { ...item, status } : item)),
    );

    try {
      await updateTaskStatus(taskId, status);
      await load();
    } catch (err) {
      setTasks((current) =>
        current.map((item) => (item.id === taskId ? { ...item, status: previousStatus } : item)),
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTaskIds((current) => current.filter((id) => id !== taskId));
    }
  }

  function handleDispatch() {
    if (dispatching) return;
    if (!isMember) return;

    setError(null);
    setDispatching(true);
    setDispatchLogs(["Dang khoi dong AI dieu phoi..."]);

    void (async () => {
      try {
        const jobId = await startDispatch();
        let seen = 0;

        const timer = window.setInterval(() => {
          void (async () => {
            try {
              const job = await getDispatchStatus(jobId);

              if (job.logs.length > seen) {
                const fresh = job.logs.slice(seen);
                seen = job.logs.length;
                setDispatchLogs((current) => [...current, ...fresh].slice(-80));
              }

              await load();

              if (job.status !== "running") {
                window.clearInterval(timer);
                setDispatching(false);
                if (job.summary) {
                  setDispatchLogs((current) =>
                    [...current, "- Hoan tat -", job.summary as string].slice(-80),
                  );
                }
                if (job.error) setError(job.error);
                await load();
              }
            } catch (err) {
              window.clearInterval(timer);
              setDispatching(false);
              setError(err instanceof Error ? err.message : String(err));
            }
          })();
        }, 1200);
      } catch (err) {
        setDispatching(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }

  function handleDragStart(event: DragEvent<HTMLElement>, taskId: number) {
    if (!isMember) return;
    if (savingTaskIds.includes(taskId)) return;
    setDraggingTaskId(taskId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(taskId));
  }

  function handleDragEnd() {
    setDraggingTaskId(null);
    setDragOverStatus(null);
  }

  function handleColumnDragOver(event: DragEvent<HTMLElement>, status: TaskStatus) {
    if (!isMember) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }

  function handleColumnDragLeave(event: DragEvent<HTMLElement>, status: TaskStatus) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragOverStatus((current) => (current === status ? null : current));
  }

  function handleColumnDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    if (!isMember) return;
    event.preventDefault();
    const rawTaskId = event.dataTransfer.getData("text/plain") || String(draggingTaskId ?? "");
    const droppedTaskId = Number(rawTaskId);
    setDraggingTaskId(null);
    setDragOverStatus(null);
    if (!Number.isInteger(droppedTaskId)) return;
    void moveTask(droppedTaskId, status);
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isMember) return;
    const title = newTitle.trim();
    if (!title) return;

    await withBusy(async () => {
      await createTask(title, newDescription.trim(), newTaskAssigneeId || undefined);
      setNewTitle("");
      setNewDescription("");
      setNewTaskAssigneeId("");
      setTaskDialogOpen(false);
    });
  }

  async function handleJoinBoard() {
    if (!hasCompleteProfile) {
      router.push("/profiles");
      return;
    }

    await withBusy(async () => void (await joinBoard()));
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  const isMember = user ? members.some((member) => member.id === user.id) : false;

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <ArrowPathIcon className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm text-slate-400">Checking your session...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute top-1/2 -right-32 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              Kanban Board
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Shared workspace - {members.length} members - {tasks.length} tasks
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <NavTabs />
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-xl">
              {user && (
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor(
                      user.email,
                    )} text-sm font-semibold text-white`}
                  >
                    {initials(user.name)}
                  </div>
                  <div className="hidden sm:block">
                    <div className="text-sm font-medium text-white">{user.name}</div>
                    <div className="text-xs text-slate-400">
                      {isMember ? "Board member" : "Not joined"}
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Log out
              </button>
            </div>
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3">
            {!isMember ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void withBusy(async () => void (await joinBoard()))}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-50"
                >
                  <UserPlusIcon className="h-4 w-4" />
                  Join board
                </button>
                <span className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                  <EyeIcon className="h-4 w-4" />
                  View only — join board to edit
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || dispatching}
                  onClick={handleDispatch}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30 disabled:opacity-50"
                >
                  <span className={dispatching ? "animate-pulse" : ""}>🤖</span>
                  {dispatching ? "Đang điều phối..." : "AI điều phối"}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setTaskDialogOpen(true)}
                  className="ml-auto inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add
                </button>
              </>
            )}
          </div>
        </section>

        {taskDialogOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl shadow-black/40">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-white">Add task</h2>
                <button
                  type="button"
                  onClick={() => setTaskDialogOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                  title="Close"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={submitTask} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Name</label>
                  <input
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder="Task name"
                    className={inputClass}
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
                  <textarea
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                    placeholder="Description"
                    className={inputClass}
                    rows={4}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Assign</label>
                  <select
                    value={newTaskAssigneeId}
                    onChange={(event) => setNewTaskAssigneeId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setTaskDialogOpen(false)}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !newTitle.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-50"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {dispatching || dispatchLogs.length > 0 ? (
          <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 backdrop-blur-xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-300">
              <span className={dispatching ? "animate-pulse" : ""}>*</span>
              AI Dispatch {dispatching ? "running" : "complete"}
            </div>
            <div className="max-h-60 space-y-1 overflow-auto text-xs leading-relaxed text-slate-300">
              {dispatchLogs.map((line, index) => (
                <div
                  key={`${index}-${line}`}
                  className="whitespace-pre-wrap rounded bg-slate-900/50 px-2 py-1"
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <section className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const columnTasks = tasks.filter((task) => task.status === column.status);
            const isDragTarget = dragOverStatus === column.status && draggingTaskId !== null;

            return (
              <section
                key={column.status}
                onDragOver={(event) => handleColumnDragOver(event, column.status)}
                onDragLeave={(event) => handleColumnDragLeave(event, column.status)}
                onDrop={(event) => handleColumnDrop(event, column.status)}
                className={[
                  "flex min-h-[520px] flex-col rounded-2xl border bg-white/5 backdrop-blur-xl transition-colors",
                  isDragTarget ? "border-cyan-400 bg-cyan-400/10" : "border-white/10",
                ].join(" ")}
              >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${column.accent}`}
                    />
                    <h2 className="font-semibold text-white">{column.label}</h2>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                    {columnTasks.length}
                  </span>
                </div>

                <div className="flex-1 space-y-3 p-3">
                  {columnTasks.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-500">Empty</p>
                  ) : (
                    columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        members={members}
                        assignee={task.assigneeId ? membersById.get(task.assigneeId) : undefined}
                        canEdit={isMember}
                        dragging={draggingTaskId === task.id}
                        saving={savingTaskIds.includes(task.id)}
                        busy={busy}
                        onAssign={(memberId) =>
                          void withBusy(async () => void (await assignTask(task.id, memberId)))
                        }
                        onAdvance={(status) => void moveTask(task.id, status)}
                        onDragStart={(event) => handleDragStart(event, task.id)}
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function TaskCard({
  task,
  members,
  assignee,
  canEdit,
  dragging,
  saving,
  busy,
  onAssign,
  onAdvance,
  onDragStart,
  onDragEnd,
}: {
  task: KanbanTask;
  members: Member[];
  assignee?: Member;
  canEdit: boolean;
  dragging: boolean;
  saving: boolean;
  busy: boolean;
  onAssign: (memberId: string) => void;
  onAdvance: (status: TaskStatus) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const nextStatus = NEXT_STATUS[task.status];
  const assigneeName =
    task.assigneeId === "ai-agent" ? "AI Agent" : assignee?.name ?? task.assigneeId ?? null;

  return (
    <article
      draggable={canEdit && !saving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={saving}
      className={[
        "rounded-xl border border-white/10 bg-slate-900/70 p-3 transition-all hover:border-indigo-400/40",
        !canEdit ? "cursor-default" : saving ? "cursor-wait opacity-70" : "cursor-grab active:cursor-grabbing",
        dragging ? "border-cyan-400 opacity-60 outline outline-2 outline-cyan-400/30" : "",
      ].join(" ")}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-medium text-white">{task.title}</h3>
          {task.description ? (
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">
              {task.description}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
          #{task.id}
        </span>
      </div>

      {task.labels.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label}
              className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 text-xs text-slate-400">
        <div className="flex items-center justify-between gap-2">
          {assigneeName ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor(
                  task.assigneeId ?? task.title,
                )} text-[10px] font-semibold text-white`}
              >
                {initials(assigneeName)}
              </div>
              <span className="truncate">{assigneeName}</span>
            </div>
          ) : canEdit ? (
            <select
              disabled={busy || saving}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onAssign(event.target.value);
              }}
              className="max-w-full rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none"
            >
              <option value="">Assign to...</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-slate-500">Unassigned</span>
          )}

          <span className="shrink-0 font-medium text-slate-300">
            {PRIORITY_LABELS[task.priority] ?? "Medium"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          {task.artifactUrl ? (
            <a
              href={task.artifactUrl}
              className="inline-flex min-w-0 items-center gap-1 font-medium text-cyan-300 hover:text-cyan-200"
              target="_blank"
              rel="noreferrer"
            >
              <LinkIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">Artifact</span>
            </a>
          ) : (
            <span />
          )}

          {nextStatus ? (
            <button
              type="button"
              disabled={!canEdit || busy || saving}
              onClick={() => onAdvance(nextStatus)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <ArrowRightIcon className="h-3.5 w-3.5" />
              {COLUMNS.find((column) => column.status === nextStatus)?.label}
            </button>
          ) : (
            <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
              Done
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

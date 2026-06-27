"use client";

<<<<<<< HEAD
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import {
  ArrowPathIcon,
  LinkIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { DispatchEvent, KanbanTask, Member, TaskStatus } from "../../../shared/contract";
=======
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession, logout, type User } from "../lib/auth";
import {
  assignTask,
  createTask,
  joinBoard,
  listMembers,
  listTasks,
  syncMembers,
  updateTaskStatus,
  type KanbanTask,
  type Member,
  type TaskStatus,
} from "../lib/board";
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e

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
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

<<<<<<< HEAD

export default function App() {
=======
export default function BoardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
<<<<<<< HEAD
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [savingTaskIds, setSavingTaskIds] = useState<number[]>([]);
=======
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([listTasks(), listMembers()]);
      setTasks(t);
      setMembers(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    fetchSession().then((u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
      setAuthChecked(true);
      load();
    });
  }, [router, load]);

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

<<<<<<< HEAD
  async function moveTask(taskId: number, status: TaskStatus) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status || savingTaskIds.includes(taskId)) return;

    const previousStatus = task.status;
    setError(null);
    setSavingTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
    setTasks((current) =>
      current.map((item) => (item.id === taskId ? { ...item, status } : item)),
    );

    try {
      const updated = await apiJSON<KanbanTask>(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      upsertTask(updated);
    } catch (err) {
      setTasks((current) =>
        current.map((item) => (item.id === taskId ? { ...item, status: previousStatus } : item)),
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTaskIds((current) => current.filter((id) => id !== taskId));
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, taskId: number) {
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
    event.preventDefault();
    const droppedTaskId = Number(event.dataTransfer.getData("text/plain") || draggingTaskId);
    setDraggingTaskId(null);
    setDragOverStatus(null);
    if (!Number.isInteger(droppedTaskId)) return;
    void moveTask(droppedTaskId, status);
  }

  function applyDispatchEvent(event: DispatchEvent) {
    if (event.type === "log") {
      setLogs((current) => [...current, event.text].slice(-40));
      return;
    }
=======
  const memberName = (id: string | null) => {
    if (!id) return null;
    if (id === "ai-agent") return "AI Agent";
    return members.find((m) => m.id === id)?.name ?? id;
  };

  const isMember = user ? members.some((m) => m.id === user.id) : false;
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-sm text-slate-400">Đang kiểm tra đăng nhập...</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute top-1/2 -right-32 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8">
        {/* header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              Kanban Board
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Bảng dùng chung · {members.length} thành viên · {tasks.length} task
            </p>
          </div>
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
                    {isMember ? "Thành viên board" : "Chưa tham gia"}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => logout().then(() => router.replace("/login"))}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Đăng xuất
            </button>
          </div>
        </header>

        {/* toolbar */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
          {!isMember && (
            <button
              disabled={busy}
              onClick={() => withBusy(async () => void (await joinBoard()))}
              className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-50"
            >
              + Tham gia board
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => withBusy(async () => void (await syncMembers()))}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            Đồng bộ tất cả profile
          </button>

          <div className="ml-auto flex flex-1 items-center gap-2 sm:flex-none">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Thêm task mới..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-400 sm:w-64"
            />
            <button
              disabled={busy || !newTitle.trim()}
              onClick={() =>
                withBusy(async () => {
                  await createTask(newTitle.trim(), "");
                  setNewTitle("");
                })
              }
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              Thêm
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

<<<<<<< HEAD
        <section className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {STATUSES.map((column) => {
              const columnTasks = tasks.filter((task) => task.status === column.id);
              const isDragTarget = dragOverStatus === column.id && draggingTaskId !== null;
              return (
                <section
                  key={column.id}
                  onDragOver={(event) => handleColumnDragOver(event, column.id)}
                  onDragLeave={(event) => handleColumnDragLeave(event, column.id)}
                  onDrop={(event) => handleColumnDrop(event, column.id)}
                  className={[
                    "flex min-h-[520px] flex-col rounded-md border bg-slate-200 transition-colors",
                    isDragTarget ? "border-cyan-500 bg-cyan-50" : "border-slate-300",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between border-b border-slate-300 px-3 py-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{column.title}</h2>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {columnTasks.length}
                    </span>
=======
        {/* columns */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            return (
              <div
                key={col.status}
                className="flex flex-col rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl"
              >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${col.accent}`} />
                    <span className="font-semibold text-white">{col.label}</span>
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                    {colTasks.length}
                  </span>
                </div>

                <div className="flex-1 space-y-3 p-3">
                  {colTasks.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">Trống</p>
                  ) : (
                    colTasks.map((task) => {
                      const next = NEXT_STATUS[task.status];
                      const assignee = memberName(task.assigneeId);
                      return (
                        <div
                          key={task.id}
<<<<<<< HEAD
                          task={task}
                          assignee={task.assigneeId ? membersById.get(task.assigneeId) : undefined}
                          dragging={draggingTaskId === task.id}
                          saving={savingTaskIds.includes(task.id)}
                          onEdit={() => openEditForm(task)}
                          onDragStart={(event) => handleDragStart(event, task.id)}
                          onDragEnd={handleDragEnd}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
=======
                          className="rounded-xl border border-white/10 bg-slate-900/60 p-3 transition-all hover:border-indigo-400/40"
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-white">{task.title}</span>
                            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                              #{task.id}
                            </span>
                          </div>
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e

                          {task.labels.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1">
                              {task.labels.map((l) => (
                                <span
                                  key={l}
                                  className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300"
                                >
                                  {l}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2">
                            {assignee ? (
                              <div className="flex items-center gap-1.5">
                                <div
                                  className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor(
                                    task.assigneeId ?? "x",
                                  )} text-[10px] font-semibold text-white`}
                                >
                                  {initials(assignee)}
                                </div>
                                <span className="text-xs text-slate-400">{assignee}</span>
                              </div>
                            ) : (
                              <select
                                disabled={busy}
                                defaultValue=""
                                onChange={(e) =>
                                  e.target.value &&
                                  withBusy(async () => void (await assignTask(task.id, e.target.value)))
                                }
                                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none"
                              >
                                <option value="">Gán cho...</option>
                                {members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {next && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  withBusy(async () => await updateTaskStatus(task.id, next))
                                }
                                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
                              >
                                → {COLUMNS.find((c) => c.status === next)?.label}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
<<<<<<< HEAD
      ) : null}
    </main>
  );
}

function TaskCard({
  task,
  assignee,
  dragging,
  saving,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  task: KanbanTask;
  assignee?: Member;
  dragging: boolean;
  saving: boolean;
  onEdit: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const assigneeName = task.assigneeId === "ai-agent" ? "AI" : assignee?.name ?? "Unassigned";

  return (
    <article
      draggable={!saving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={saving}
      className={[
        "rounded-md border bg-white p-3 shadow-sm transition",
        saving ? "cursor-wait border-slate-200 opacity-70" : "cursor-grab border-slate-200 active:cursor-grabbing",
        dragging ? "border-cyan-500 opacity-60 outline outline-2 outline-cyan-200" : "",
      ].join(" ")}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-5 text-slate-950">{task.title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <PencilSquareIcon className="h-4 w-4" />
        </button>
      </div>
      <p className="line-clamp-3 text-sm leading-5 text-slate-600">{task.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {task.labels.map((label) => (
          <span key={label} className="rounded bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-800">
            {label}
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-600">
        <div className="flex items-center justify-between">
          <span>{assigneeName}</span>
          <span className="font-medium text-slate-800">{PRIORITY_LABELS[task.priority] ?? "Medium"}</span>
        </div>
        {task.artifactUrl ? (
          <a
            href={task.artifactUrl}
            className="inline-flex items-center gap-1 font-medium text-cyan-700 hover:text-cyan-600"
            target="_blank"
            rel="noreferrer"
          >
            <LinkIcon className="h-4 w-4" />
            Artifact
          </a>
        ) : null}
      </div>
    </article>
=======
      </div>
    </div>
>>>>>>> d3ec3d865e526638d41f4e4c8e60f793349b197e
  );
}

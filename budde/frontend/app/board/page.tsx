"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession, logout, type User } from "../lib/auth";
import {
  assignTask,
  createTask,
  getDispatchStatus,
  joinBoard,
  listMembers,
  listTasks,
  startDispatch,
  syncMembers,
  updateTaskStatus,
  type KanbanTask,
  type Member,
  type TaskStatus,
} from "../lib/board";

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

export default function BoardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchLogs, setDispatchLogs] = useState<string[]>([]);

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

  // Bấm "AI điều phối" → start (chạy nền) → poll status (logs) + reload board mỗi 1.2s.
  function handleDispatch() {
    setError(null);
    setDispatching(true);
    setDispatchLogs(["Đang khởi động AI điều phối..."]);

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

              // Board là DB thật — reload để card tự nhảy cột theo agent.
              await load();

              if (job.status !== "running") {
                window.clearInterval(timer);
                setDispatching(false);
                if (job.summary) {
                  setDispatchLogs((current) =>
                    [...current, "— Hoàn tất —", job.summary as string].slice(-80),
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

  const memberName = (id: string | null) => {
    if (!id) return null;
    if (id === "ai-agent") return "AI Agent";
    return members.find((m) => m.id === id)?.name ?? id;
  };

  const isMember = user ? members.some((m) => m.id === user.id) : false;

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
          <button
            disabled={busy || dispatching}
            onClick={handleDispatch}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30 disabled:opacity-50"
          >
            <span className={dispatching ? "animate-pulse" : ""}>🤖</span>
            {dispatching ? "Đang điều phối..." : "AI điều phối"}
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

        {/* AI dispatch log panel */}
        {(dispatching || dispatchLogs.length > 0) && (
          <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 backdrop-blur-xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-300">
              <span className={dispatching ? "animate-pulse" : ""}>●</span>
              AI Dispatch {dispatching ? "đang chạy" : "đã xong"}
            </div>
            <div className="max-h-60 space-y-1 overflow-auto text-xs leading-relaxed text-slate-300">
              {dispatchLogs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap rounded bg-slate-900/50 px-2 py-1">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

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
                      const isAI = task.assigneeId === "ai-agent";
                      return (
                        <div
                          key={task.id}
                          className="rounded-xl border border-white/10 bg-slate-900/60 p-3 transition-all hover:border-indigo-400/40"
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-white">{task.title}</span>
                            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                              #{task.id}
                            </span>
                          </div>

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
                                  className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${
                                    isAI ? "from-cyan-500 to-indigo-600" : avatarColor(task.assigneeId ?? "x")
                                  } text-[10px] font-semibold text-white`}
                                >
                                  {isAI ? "🤖" : initials(assignee)}
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

                          {task.artifactUrl && (
                            <a
                              href={task.artifactUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-block text-xs font-medium text-cyan-400 hover:text-cyan-300"
                            >
                              ↗ Xem artifact
                            </a>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

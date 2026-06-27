"use client";

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

const STATUSES: Array<{ id: TaskStatus; title: string }> = [
  { id: "todo", title: "Todo" },
  { id: "in_progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];

const PRIORITY_LABELS: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

type TaskForm = {
  id?: number;
  title: string;
  description: string;
  labels: string;
  priority: number;
};

const EMPTY_FORM: TaskForm = {
  title: "",
  description: "",
  labels: "",
  priority: 2,
};

async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Request failed: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

function labelsFromInput(value: string): string[] {
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}


export default function App() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [savingTaskIds, setSavingTaskIds] = useState<number[]>([]);

  const membersById = useMemo(() => {
    const index = new Map<string, Member>();
    for (const member of members) index.set(member.id, member);
    return index;
  }, [members]);

  async function loadBoard() {
    setError(null);
    const [taskResp, memberResp] = await Promise.all([
      apiJSON<{ tasks: KanbanTask[] }>("/tasks"),
      apiJSON<{ members: Member[] }>("/members"),
    ]);
    setTasks(taskResp.tasks);
    setMembers(memberResp.members);
  }

  useEffect(() => {
    void loadBoard()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  function upsertTask(task: KanbanTask) {
    setTasks((current) => {
      const exists = current.some((item) => item.id === task.id);
      if (!exists) return [...current, task];
      return current.map((item) => (item.id === task.id ? task : item));
    });
  }

  function openCreateForm() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEditForm(task: KanbanTask) {
    setForm({
      id: task.id,
      title: task.title,
      description: task.description,
      labels: task.labels.join(", "),
      priority: task.priority,
    });
    setFormOpen(true);
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        title: form.title,
        description: form.description,
        labels: labelsFromInput(form.labels),
        priority: form.priority,
      };

      const task = form.id
        ? await apiJSON<KanbanTask>(`/tasks/${form.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await apiJSON<KanbanTask>("/tasks", {
            method: "POST",
            body: JSON.stringify(payload),
          });

      upsertTask(task);
      setFormOpen(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

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

    if (event.type === "task_update") {
      setTasks((current) =>
        current.map((task) =>
          task.id === event.taskId
            ? { ...task, status: event.status, assigneeId: event.assigneeId }
            : task,
        ),
      );
      return;
    }

    if (event.type === "artifact") {
      setTasks((current) =>
        current.map((task) =>
          task.id === event.taskId ? { ...task, artifactUrl: event.url, status: "review" } : task,
        ),
      );
      return;
    }

    setLogs((current) => [...current, event.summary].slice(-40));
    void loadBoard().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  function startDispatch() {
    setError(null);
    setStreaming(true);
    setLogs((current) => [...current, "Starting AI dispatch..."].slice(-40));

    const url = new URL("/ai/dispatch/stream", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);

    socket.onmessage = (message) => {
      try {
        applyDispatchEvent(JSON.parse(message.data) as DispatchEvent);
      } catch {
        setLogs((current) => [...current, String(message.data)].slice(-40));
      }
    };

    socket.onerror = () => {
      setError("AI dispatch stream is not available yet.");
      setStreaming(false);
    };

    socket.onclose = () => {
      setStreaming(false);
      void loadBoard().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-4 px-4 py-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Sale/Marketing Kanban</h1>
            <p className="text-sm text-slate-600">Team A board</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadBoard().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium shadow-sm hover:bg-slate-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
            >
              <PlusIcon className="h-4 w-4" />
              Card
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

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
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-3">
                    {loading ? (
                      <div className="rounded-md bg-white p-4 text-sm text-slate-500">Loading...</div>
                    ) : columnTasks.length === 0 ? (
                      <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                        Empty
                      </div>
                    ) : (
                      columnTasks.map((task) => (
                        <TaskCard
                          key={task.id}
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

          <aside className="flex min-h-[520px] flex-col rounded-md border border-slate-300 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">AI Dispatch</h2>
              <button
                type="button"
                onClick={startDispatch}
                disabled={streaming}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white shadow-sm hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <SparklesIcon className="h-4 w-4" />
                {streaming ? "Running" : "Start"}
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-3">
              {logs.length === 0 ? (
                <p className="text-sm text-slate-500">No dispatch events yet.</p>
              ) : (
                logs.map((line, index) => (
                  <div key={`${line}-${index}`} className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    {line}
                  </div>
                ))
              )}
            </div>
          </aside>
        </section>
      </div>

      {formOpen ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={submitTask} className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold">{form.id ? "Edit card" : "Create card"}</h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Title
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-cyan-600"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Description
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="mt-1 block min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-600"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <label className="block text-sm font-medium text-slate-700">
                  Labels
                  <input
                    value={form.labels}
                    onChange={(event) => setForm((current) => ({ ...current, labels: event.target.value }))}
                    className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-cyan-600"
                    placeholder="SEO, Content"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Priority
                  <select
                    value={form.priority}
                    onChange={(event) => setForm((current) => ({ ...current, priority: Number(event.target.value) }))}
                    className="mt-1 block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-600"
                  >
                    <option value={1}>High</option>
                    <option value={2}>Medium</option>
                    <option value={3}>Low</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-10 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {saving ? "Saving" : "Save"}
              </button>
            </div>
          </form>
        </div>
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
  );
}

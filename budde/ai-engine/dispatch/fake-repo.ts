/**
 * FakeRepo — implement DispatchRepository in-memory từ seed.json.
 * Cho phép test agent loop HOÀN TOÀN tách rời backend Encore (milestone §7.2).
 *
 * Atomic semantics: assignTask/claimTask chỉ thành công khi task còn 'todo'
 * → gọi lần 2 trả false (chống gán đè khi bấm Start nhiều lần).
 */
import { readFileSync } from "node:fs";
import type {
  DispatchRepository,
  KanbanTask,
  Member,
  TaskStatus,
} from "./contract.ts";

interface Seed {
  members: Member[];
  tasks: KanbanTask[];
}

function loadSeed(): Seed {
  const raw = readFileSync(new URL("./seed.json", import.meta.url), "utf8");
  return JSON.parse(raw) as Seed;
}

export interface FakeRepo extends DispatchRepository {
  /** Trả toàn bộ task (mọi status) — để verify state sau khi chạy. */
  dump(): KanbanTask[];
}

export function makeFakeRepo(): FakeRepo {
  const seed = loadSeed();
  const tasks: KanbanTask[] = structuredClone(seed.tasks);
  const members: Member[] = structuredClone(seed.members);

  const find = (id: number) => tasks.find((t) => t.id === id);

  return {
    getTodoTasks: async () => tasks.filter((t) => t.status === "todo"),
    getMembers: async () => members,

    assignTask: async (taskId, assigneeId) => {
      const t = find(taskId);
      if (!t || t.status !== "todo") return false; // atomic guard
      t.assigneeId = assigneeId;
      t.status = "in_progress";
      return true;
    },

    claimTask: async (taskId) => {
      const t = find(taskId);
      if (!t || t.status !== "todo") return false;
      t.assigneeId = "ai-agent";
      t.status = "in_progress";
      return true;
    },

    attachArtifact: async (taskId, url, status?: TaskStatus) => {
      const t = find(taskId);
      if (!t) return;
      t.artifactUrl = url;
      t.status = status ?? "review";
    },

    dump: () => structuredClone(tasks),
  };
}

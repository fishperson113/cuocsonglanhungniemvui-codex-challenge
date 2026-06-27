/**
 * EncoreRepo — implement DispatchRepository bằng cách gọi service `board` thật
 * qua `~encore/clients` (đọc/ghi Postgres). Thay cho FakeRepo khi chạy production.
 *
 * Chỉ import được dưới Encore runtime (không chạy bằng `node` trực tiếp).
 * Mọi khác biệt schema FE/board ↔ contract sống ở ĐÂY (xem devlog §3).
 */
import { board } from "~encore/clients";
import type { DispatchRepository } from "./contract.ts";

export const encoreRepo: DispatchRepository = {
  getTodoTasks: async () => {
    const { tasks } = await board.listTasks({ status: "todo" });
    return tasks;
  },
  getMembers: async () => {
    const { members } = await board.listMembers();
    return members;
  },
  assignTask: async (taskId, assigneeId) => {
    const { ok } = await board.assignTask({ id: taskId, memberId: assigneeId });
    return ok;
  },
  claimTask: async (taskId) => {
    const { ok } = await board.claimTask({ id: taskId });
    return ok;
  },
  attachArtifact: async (taskId, url, status) => {
    await board.attachArtifact({ id: taskId, url, status });
  },
};

/**
 * MCP tools (in-process) cho agent điều phối. Mỗi tool gọi vào DispatchRepository.
 * Agent dùng các tool này để đọc task/member và ghi assignment.
 *
 * Phase 2 scope: get_todo_tasks, get_members, assign_task, claim_task.
 * (generate_document — LaTeX — để Phase 4.)
 */
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DispatchRepository } from "./contract.ts";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

export function createDispatchServer(
  repo: DispatchRepository,
  log: (s: string) => void,
) {
  return createSdkMcpServer({
    name: "dispatch",
    version: "1.0.0",
    tools: [
      tool(
        "get_todo_tasks",
        "Lấy mọi task đang ở trạng thái todo (chưa ai nhận).",
        {},
        async () => {
          const tasks = await repo.getTodoTasks();
          log(`📥 get_todo_tasks → ${tasks.length} task`);
          return ok(tasks);
        },
      ),
      tool(
        "get_members",
        "Lấy danh sách member kèm title/skills/currentLoad để matching.",
        {},
        async () => {
          const members = await repo.getMembers();
          log(`👥 get_members → ${members.length} member`);
          return ok(members);
        },
      ),
      tool(
        "assign_task",
        "Gán 1 task cho member phù hợp nhất (theo title/skills, cân bằng tải).",
        {
          taskId: z.number().describe("id của task"),
          memberId: z.string().describe("id của member nhận task"),
          reason: z.string().describe("lý do chọn member này"),
        },
        async ({ taskId, memberId, reason }) => {
          const success = await repo.assignTask(taskId, memberId);
          log(
            success
              ? `✓ assign #${taskId} → ${memberId} (${reason})`
              : `✗ assign #${taskId} thất bại (task không còn 'todo')`,
          );
          return ok({ success });
        },
      ),
      tool(
        "claim_task",
        "AI TỰ NHẬN task in-scope (yêu cầu VIẾT BÁO CÁO hoặc LÀM SLIDE). " +
          "Set assignee='ai-agent'. Dùng thay cho assign_task khi task thuộc khả năng AI.",
        {
          taskId: z.number().describe("id của task in-scope"),
          reason: z.string().describe("vì sao task này in-scope (report/slide)"),
        },
        async ({ taskId, reason }) => {
          const success = await repo.claimTask(taskId);
          log(
            success
              ? `🤖 claim #${taskId} (AI tự nhận — ${reason})`
              : `✗ claim #${taskId} thất bại (task không còn 'todo')`,
          );
          return ok({ success });
        },
      ),
    ],
  });
}

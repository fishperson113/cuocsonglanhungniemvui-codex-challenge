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
import { compileLatex } from "../latex/compile.ts";

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
      tool(
        "generate_document",
        "Tạo tài liệu PDF (slide hoặc report) cho task in-scope AI đã claim. " +
          "AI CHỈ viết phần THÂN LaTeX: slide → các \\begin{frame}...\\end{frame}; " +
          "report → các \\section{...} + đoạn văn/itemize/bảng. " +
          "TUYỆT ĐỐI KHÔNG viết \\documentclass hay preamble (đã có sẵn trong template). " +
          "Nếu trả success=false kèm error → đọc log, sửa latexBody rồi gọi lại.",
        {
          taskId: z.number().describe("id task đã claim"),
          kind: z.enum(["slide", "report"]).describe("slide cho thuyết trình, report cho báo cáo"),
          title: z.string().describe("tiêu đề tài liệu"),
          subtitle: z.string().optional().describe("phụ đề (tuỳ chọn)"),
          latexBody: z.string().describe("phần thân LaTeX hợp lệ, KHÔNG có preamble"),
        },
        async ({ taskId, kind, title, subtitle, latexBody }) => {
          try {
            const res = await compileLatex(kind, {
              title,
              subtitle,
              author: "AI Agent",
              body: latexBody,
            });
            await repo.attachArtifact(taskId, res.url, "review");
            log(`📄 generate_document #${taskId} (${kind}) → ${res.url}`);
            return ok({ success: true, url: res.url });
          } catch (e) {
            log(`✗ compile #${taskId} lỗi — agent sẽ sửa LaTeX`);
            return ok({ success: false, error: String(e).slice(-1500) });
          }
        },
      ),
    ],
  });
}

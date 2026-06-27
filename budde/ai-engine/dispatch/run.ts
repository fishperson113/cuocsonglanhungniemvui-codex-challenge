/**
 * runDispatch — agent loop điều phối, dùng Claude Agent SDK (spawn `claude` CLI, Pro quota).
 *
 * Không set ANTHROPIC_API_KEY → dùng login Pro (đã verify ở Phase 1).
 * Agent đọc seed (qua FakeRepo hoặc EncoreRepo) rồi gán task cho đúng người /
 * tự nhận task in-scope.
 */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createDispatchServer } from "./tools.ts";
import type { DispatchRepository } from "./contract.ts";

/** Model mặc định — sonnet cho test loop (nhanh/đỡ quota); override bằng env DISPATCH_MODEL. */
const MODEL = process.env.DISPATCH_MODEL || "claude-sonnet-4-6";

const PROMPT = `Bạn là điều phối viên team marketing. Quy trình BẮT BUỘC:
1. Gọi get_todo_tasks và get_members để nắm dữ liệu.
2. Với MỖI task:
   - Nếu nội dung yêu cầu VIẾT BÁO CÁO hoặc LÀM SLIDE (in-scope của AI):
     → gọi claim_task(taskId, reason) để AI TỰ NHẬN, RỒI gọi
       generate_document(taskId, kind, title, latexBody) để tạo PDF
       (kind="slide" nếu là slide/thuyết trình, "report" nếu là báo cáo).
       Tự viết nội dung LaTeX phần thân phù hợp với task (tiếng Việt được).
   - Ngược lại → gọi assign_task(taskId, memberId, reason), chọn member khớp
     title/skills nhất; nếu hoà thì ưu tiên currentLoad thấp hơn (cân bằng tải).
3. Nếu tool trả success=false thì bỏ qua task đó (đã bị giữ).
4. Khi xử lý hết, tóm tắt NGẮN GỌN: mỗi task ai nhận và vì sao.
KHÔNG hỏi lại, cứ thực hiện tới khi xong.`;

export async function runDispatch(
  repo: DispatchRepository,
  onLog: (s: string) => void,
): Promise<string> {
  const server = createDispatchServer(repo, onLog);

  // Custom MCP tools cần streaming input → prompt là async generator.
  async function* promptStream() {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: PROMPT },
      parent_tool_use_id: null,
    };
  }

  let summary = "Hoàn tất.";

  for await (const msg of query({
    prompt: promptStream(),
    options: {
      model: MODEL,
      maxTurns: 30,
      mcpServers: { dispatch: server },
      allowedTools: [
        "mcp__dispatch__get_todo_tasks",
        "mcp__dispatch__get_members",
        "mcp__dispatch__assign_task",
        "mcp__dispatch__claim_task",
        "mcp__dispatch__generate_document",
      ],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Resolve claude.exe trên Windows nếu SDK không tự tìm thấy.
      ...(process.env.CLAUDE_CLI_PATH
        ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CLI_PATH }
        : {}),
      stderr: (data: string) => {
        if (data.trim()) onLog(`[stderr] ${data.trim()}`);
      },
    },
  }) as AsyncIterable<SDKMessage>) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) onLog(block.text.trim());
      }
    } else if (msg.type === "result" && msg.subtype === "success") {
      summary = msg.result;
    }
  }

  return summary;
}

/**
 * Thin subprocess wrapper around the `claude` CLI (Track B — Pro quota, no API key).
 *
 * Mục đích: lớp THẤP NHẤT của orchestration — spawn `claude` headless, đọc kết quả
 * dạng `stream-json` (NDJSON). Không phụ thuộc Encore nên test độc lập được
 * (`node ai-engine/scripts/smoke.ts`) trước khi ráp vào service.
 *
 * Thiết kế cho Windows: prompt được ghi qua STDIN (không truyền làm arg) để tránh
 * mọi vấn đề quoting/space; spawn qua shell để resolve `claude.exe` trên PATH.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Resolve binary `claude`:
 * - env CLAUDE_CLI_PATH nếu set (path tuyệt đối)
 * - non-Windows: bare "claude" (PATH lo)
 * - Windows: quét PATH tìm claude.exe/.cmd/.bat để spawn không cần shell (tránh DEP0190);
 *   fallback sh:true nếu không tìm thấy.
 */
function resolveClaudeBin(): { cmd: string; shell: boolean } {
  const override = process.env.CLAUDE_CLI_PATH;
  if (override) return { cmd: override, shell: false };
  if (process.platform !== "win32") return { cmd: "claude", shell: false };

  const dirs = (process.env.PATH || "").split(delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of [".exe", ".cmd", ".bat"]) {
      const candidate = join(dir, `claude${ext}`);
      if (existsSync(candidate)) return { cmd: candidate, shell: false };
    }
  }
  return { cmd: "claude", shell: true };
}

const CLAUDE_BIN = resolveClaudeBin();

/** Một dòng NDJSON do `--output-format stream-json` bắn ra. */
export interface StreamEvent {
  type: string;
  subtype?: string;
  [k: string]: unknown;
}

export interface RunClaudeOptions {
  /** Model id, vd "claude-opus-4-8" / "claude-sonnet-4-6". Bỏ trống = mặc định CLI. */
  model?: string;
  /** Thư mục làm việc cho subprocess. */
  cwd?: string;
  /** Timeout (ms) trước khi kill subprocess. Mặc định 120s. */
  timeoutMs?: number;
  /** Callback cho từng event NDJSON khi nó tới (để stream tiến trình ra ngoài). */
  onEvent?: (evt: StreamEvent) => void;
  /**
   * Giữ ANTHROPIC_API_KEY trong env của subprocess.
   * Mặc định FALSE → strip key để ép dùng quota Pro (đúng Track B milestone).
   */
  useApiKey?: boolean;
  /** Args bổ sung truyền thẳng cho CLI (advanced). */
  extraArgs?: string[];
}

export interface RunClaudeResult {
  /** Text trả lời cuối cùng (từ event `result`). */
  result: string;
  /** CLI báo lỗi (is_error) hay subprocess exit code != 0. */
  isError: boolean;
  /** Exit code của subprocess. */
  exitCode: number | null;
  /** Thời gian chạy theo CLI (ms), nếu có. */
  durationMs?: number;
  /** Số turn agent đã chạy, nếu có. */
  numTurns?: number;
  /** Chi phí ước tính (USD) — với Pro quota thường ~0. */
  costUsd?: number;
  /** session_id của CLI (dùng để resume sau này). */
  sessionId?: string;
  /** Mọi event NDJSON đã parse. */
  events: StreamEvent[];
  /** stderr gộp lại (để debug). */
  stderr: string;
}

/**
 * Chạy 1 prompt qua `claude` CLI headless và trả về kết quả đã parse.
 * Ném lỗi nếu không spawn được binary hoặc timeout.
 */
export function runClaude(
  prompt: string,
  opts: RunClaudeOptions = {},
): Promise<RunClaudeResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  // Strip API key trừ khi được yêu cầu giữ → đảm bảo dùng quota Pro.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!opts.useApiKey) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }

  return new Promise<RunClaudeResult>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN.cmd, args, {
      cwd: opts.cwd,
      env,
      shell: CLAUDE_BIN.shell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const events: StreamEvent[] = [];
    let stdoutBuf = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(`claude CLI timed out sau ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: StreamEvent;
      try {
        evt = JSON.parse(trimmed) as StreamEvent;
      } catch {
        // Dòng không phải JSON (hiếm) → bỏ qua nhưng giữ để debug.
        return;
      }
      events.push(evt);
      opts.onEvent?.(evt);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        flushLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Không spawn được "${CLAUDE_BIN.cmd}": ${err.message}. ` +
            `Kiểm tra claude CLI đã cài + có trên PATH (hoặc set CLAUDE_CLI_PATH).`,
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (stdoutBuf.trim()) flushLine(stdoutBuf); // dòng cuối không có \n

      const resultEvt = events.find((e) => e.type === "result");
      const result =
        (resultEvt?.result as string | undefined) ??
        // fallback: ghép text từ các message assistant
        extractAssistantText(events);

      resolve({
        result: result ?? "",
        isError: code !== 0 || resultEvt?.is_error === true,
        exitCode: code,
        durationMs: resultEvt?.duration_ms as number | undefined,
        numTurns: resultEvt?.num_turns as number | undefined,
        costUsd: resultEvt?.total_cost_usd as number | undefined,
        sessionId: resultEvt?.session_id as string | undefined,
        events,
        stderr,
      });
    });

    // Ghi prompt qua stdin rồi đóng → CLI nhận prompt từ pipe (tránh quoting arg).
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Gom text từ các event assistant (fallback khi không có event `result`). */
function extractAssistantText(events: StreamEvent[]): string {
  const parts: string[] = [];
  for (const e of events) {
    if (e.type !== "assistant") continue;
    const msg = (e as { message?: { content?: unknown } }).message;
    const content = msg?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "text"
        ) {
          parts.push((block as { text: string }).text);
        }
      }
    }
  }
  return parts.join("\n");
}

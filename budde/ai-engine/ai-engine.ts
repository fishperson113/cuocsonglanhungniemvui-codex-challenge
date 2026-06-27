/**
 * ai-engine service — orchestration qua Claude CLI (Track B, Pro quota).
 *
 * Phase 1: chỉ có endpoint smoke test để verify subprocess `claude` CLI chạy được
 * từ trong Encore runtime. Agent dispatch / MCP tools / streaming sẽ thêm ở các phase sau.
 */
import { api } from "encore.dev/api";
import log from "encore.dev/log";
import { runClaude } from "./claude/cli";

export interface AskRequest {
  /** Prompt gửi cho claude CLI. */
  message: string;
  /** Model override (vd "claude-opus-4-8"). Bỏ trống = mặc định CLI. */
  model?: string;
}

export interface AskResponse {
  reply: string;
  isError: boolean;
  durationMs?: number;
  numTurns?: number;
  costUsd?: number;
  sessionId?: string;
}

/**
 * Gọi claude CLI 1 lượt (synchronous). Dùng để smoke-test subprocess qua app.
 * Lưu ý: chạy đồng bộ nên chỉ hợp prompt ngắn — agent dài sẽ chuyển sang streamOut.
 */
export const ask = api<AskRequest, AskResponse>(
  { method: "POST", expose: true },
  async ({ message, model }) => {
    log.info("ai-engine: spawn claude CLI", { model: model ?? "(default)" });

    const res = await runClaude(message, {
      model,
      timeoutMs: 120_000,
      onEvent: (evt) => {
        if (evt.type === "result") {
          log.info("claude result", { isError: evt.is_error, durationMs: evt.duration_ms });
        }
      },
    });

    if (res.isError) {
      log.error("claude CLI error", { exitCode: res.exitCode, stderr: res.stderr.slice(-500) });
    }

    return {
      reply: res.result,
      isError: res.isError,
      durationMs: res.durationMs,
      numTurns: res.numTurns,
      costUsd: res.costUsd,
      sessionId: res.sessionId,
    };
  },
);

/** Health check nhanh: gọi claude trả về 1 từ để xác nhận CLI + login OK. */
export const ping = api<void, AskResponse>(
  { method: "POST", expose: true },
  async () => {
    const res = await runClaude("Reply with exactly one word: pong", {
      timeoutMs: 60_000,
    });
    return {
      reply: res.result,
      isError: res.isError,
      durationMs: res.durationMs,
      numTurns: res.numTurns,
      costUsd: res.costUsd,
      sessionId: res.sessionId,
    };
  },
);

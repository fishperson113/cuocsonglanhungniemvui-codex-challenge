/**
 * Smoke test ĐỘC LẬP cho subprocess claude CLI (Phase 1 — §7.1 Tier 0 milestone).
 *
 * Chạy KHÔNG cần Encore:
 *   node ai-engine/scripts/smoke.ts
 *   node ai-engine/scripts/smoke.ts "câu hỏi tuỳ ý"
 *
 * Pass khi: in ra event `result`, isError=false, và có text trả lời.
 * Đồng thời verify đang dùng quota Pro (cost ~0, không bị đòi API key).
 */
import { runClaude } from "../openai/cli.ts";

const prompt = process.argv[2] ?? "Reply with exactly one word: ping";

console.log("→ Spawning claude CLI...");
console.log(`  prompt: ${JSON.stringify(prompt)}`);
console.log(`  ANTHROPIC_API_KEY in parent env: ${process.env.ANTHROPIC_API_KEY ? "SET (sẽ bị strip)" : "EMPTY"}`);
console.log("");

const started = Date.now();

try {
  const res = await runClaude(prompt, {
    timeoutMs: 120_000,
    onEvent: (evt) => {
      // In gọn từng event để thấy subprocess đang chạy.
      if (evt.type === "system" && evt.subtype === "init") {
        console.log(`  [init] model=${(evt as any).model} session=${(evt as any).session_id}`);
      } else if (evt.type === "assistant") {
        const blocks = (evt as any).message?.content ?? [];
        for (const b of blocks) {
          if (b.type === "text") console.log(`  [assistant] ${b.text}`);
        }
      } else if (evt.type === "result") {
        console.log(`  [result] is_error=${(evt as any).is_error}`);
      }
    },
  });

  console.log("\n=== KẾT QUẢ ===");
  console.log("result   :", JSON.stringify(res.result));
  console.log("isError  :", res.isError);
  console.log("exitCode :", res.exitCode);
  console.log("duration :", res.durationMs, "ms (CLI) /", Date.now() - started, "ms (wall)");
  console.log("numTurns :", res.numTurns);
  console.log("costUsd  :", res.costUsd, res.costUsd === 0 ? "(Pro quota ✓)" : "");
  console.log("session  :", res.sessionId);
  console.log("events   :", res.events.length);

  if (res.isError) {
    console.error("\n✗ FAIL — CLI báo lỗi. stderr:\n", res.stderr);
    process.exit(1);
  }
  if (!res.result.trim()) {
    console.error("\n✗ FAIL — không có text trả lời.");
    process.exit(1);
  }
  console.log("\n✓ PASS — subprocess vào claude CLI hoạt động.");
  process.exit(0);
} catch (err) {
  console.error("\n✗ FAIL — không chạy được subprocess:");
  console.error(err);
  process.exit(1);
}

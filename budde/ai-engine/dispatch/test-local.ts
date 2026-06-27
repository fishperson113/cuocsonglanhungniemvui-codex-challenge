/**
 * Test ĐỘC LẬP agent điều phối vs FakeRepo (milestone §7.2) — KHÔNG cần Encore/backend.
 *
 * Chạy:
 *   node ai-engine/dispatch/test-local.ts
 *   (đổi model: DISPATCH_MODEL=claude-opus-4-8 node ai-engine/dispatch/test-local.ts)
 *
 * Kỳ vọng:
 *   - 4 task người được gán đúng chuyên môn (blog→Content/SEO, banner→Designer,
 *     ads→Performance, lead→Sales).
 *   - 2 task report/slide được AI claim (assignee="ai-agent").
 *   - getTodoTasks() sau khi chạy phải RỖNG.
 */
import { makeFakeRepo } from "./fake-repo.ts";
import { runDispatch } from "./run.ts";
import { renderBoard } from "./board-view.ts";
import { loadExpected, checkExpected } from "./check-expected.ts";

const repo = makeFakeRepo();
const members = await repo.getMembers();

console.log(renderBoard(repo.dump(), members, "BẢNG TRƯỚC KHI AI ĐIỀU PHỐI"));
console.log(`\n→ Chạy agent (model: ${process.env.DISPATCH_MODEL || "claude-sonnet-4-6"})...\n`);

const started = Date.now();
const summary = await runDispatch(repo, (s) => console.log("[agent]", s));

console.log("\n=== SUMMARY (agent tự tóm tắt) ===\n" + summary);

const after = repo.dump();
console.log(renderBoard(after, members, "BẢNG SAU KHI AI ĐIỀU PHỐI"));

// ── So khớp với expected.json ──────────────────────────────────────
const expected = loadExpected();
const result = checkExpected(after, expected);

console.log("\n=== SO KHỚP VỚI expected.json ===");
for (const line of result.lines) console.log(line);

console.log(`\n⏱  ${Math.round((Date.now() - started) / 1000)}s   (${result.passed}/${result.total} khớp)`);
console.log(
  result.pass
    ? "\n✓✓ PASS — kết quả agent khớp expected.json."
    : "\n✗ FAIL — agent gán LỆCH so với expected.json (xem dòng ✗ + reason agent để chỉnh).",
);
process.exit(result.pass ? 0 : 1);

/**
 * So khớp kết quả thực tế (sau khi agent chạy) với expected.json.
 * Mỗi task: assigneeId thực tế phải nằm trong tập "assignee" chấp nhận được.
 */
import { readFileSync } from "node:fs";
import type { KanbanTask } from "./contract.ts";

export interface ExpectedTask {
  /** id member | "ai-agent" | mảng các lựa chọn chấp nhận được. */
  assignee: string | string[];
  why?: string;
}

export interface Expected {
  expectNoTodoLeft?: boolean;
  tasks: Record<string, ExpectedTask>;
}

export interface CheckResult {
  pass: boolean;
  lines: string[];
  passed: number;
  total: number;
}

export function loadExpected(): Expected {
  const raw = readFileSync(new URL("./expected.json", import.meta.url), "utf8");
  return JSON.parse(raw) as Expected;
}

export function checkExpected(tasks: KanbanTask[], expected: Expected): CheckResult {
  const lines: string[] = [];
  let passed = 0;
  let total = 0;

  for (const [idStr, exp] of Object.entries(expected.tasks)) {
    total++;
    const id = Number(idStr);
    const t = tasks.find((x) => x.id === id);
    const got = t?.assigneeId ?? "(chưa giao)";
    const accept = Array.isArray(exp.assignee) ? exp.assignee : [exp.assignee];
    const ok = t != null && t.assigneeId != null && accept.includes(t.assigneeId);
    if (ok) passed++;
    lines.push(
      `  ${ok ? "✓" : "✗"} #${id}: got=${got}  expected=${accept.join("|")}` +
        (exp.why ? `  — ${exp.why}` : ""),
    );
  }

  if (expected.expectNoTodoLeft) {
    total++;
    const left = tasks.filter((t) => t.status === "todo").length;
    const ok = left === 0;
    if (ok) passed++;
    lines.push(`  ${ok ? "✓" : "✗"} Không còn task 'todo' (còn ${left})`);
  }

  return { pass: passed === total, lines, passed, total };
}

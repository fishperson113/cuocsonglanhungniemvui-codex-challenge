/**
 * Vẽ bảng Kanban dạng ASCII ra terminal — để "nhìn thấy" task chạy giữa các cột
 * khi chưa có FE thật. Dùng trong test-local.ts (before/after).
 */
import type { KanbanTask, Member, TaskStatus } from "./contract.ts";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "📋 TODO" },
  { status: "in_progress", label: "🔧 IN PROGRESS" },
  { status: "review", label: "👀 REVIEW" },
  { status: "done", label: "✅ DONE" },
];

const COL_WIDTH = 30;

/** Ký tự "rộng" (emoji, CJK...) chiếm 2 ô. Tiếng Việt có dấu vẫn là 1 ô. */
function charWidth(cp: number): number {
  if (cp >= 0x1f000) return 2; // emoji
  if (cp >= 0x1100 && cp <= 0x115f) return 2; // Hangul Jamo
  if (cp >= 0x2e80 && cp <= 0xa4cf) return 2; // CJK
  if (cp >= 0xac00 && cp <= 0xd7a3) return 2; // Hangul
  if (cp >= 0xf900 && cp <= 0xfaff) return 2; // CJK compat
  if (cp >= 0xff00 && cp <= 0xff60) return 2; // fullwidth
  return 1;
}

function pad(s: string, w: number): string {
  let width = 0;
  let out = "";
  for (const ch of s) {
    const w2 = charWidth(ch.codePointAt(0)!);
    if (width + w2 > w) break;
    out += ch;
    width += w2;
  }
  return out + " ".repeat(Math.max(0, w - width));
}

export function renderBoard(
  tasks: KanbanTask[],
  members: Member[],
  title: string,
): string {
  const nameOf = (id: string | null): string => {
    if (!id) return "";
    if (id === "ai-agent") return "🤖 AI";
    return members.find((m) => m.id === id)?.name ?? id;
  };

  // mỗi cột là 1 list các dòng (card có thể chiếm 2 dòng: tiêu đề + người nhận)
  const cols = COLUMNS.map(({ status }) => {
    const cards: string[] = [];
    for (const t of tasks.filter((x) => x.status === status)) {
      cards.push(`#${t.id} ${t.title}`);
      const who = nameOf(t.assigneeId);
      cards.push(who ? `   └ ${who}` : "   └ (chưa giao)");
      cards.push(""); // dòng trống ngăn card
    }
    return cards;
  });

  const height = Math.max(1, ...cols.map((c) => c.length));
  const lines: string[] = [];

  // header
  lines.push("");
  lines.push(`╭─ ${title} ${"─".repeat(Math.max(0, COL_WIDTH * 4 - title.length - 3))}╮`);
  lines.push(COLUMNS.map((c) => pad(" " + c.label, COL_WIDTH)).join("│"));
  lines.push(COLUMNS.map(() => "─".repeat(COL_WIDTH)).join("┼"));

  for (let r = 0; r < height; r++) {
    lines.push(cols.map((c) => pad(" " + (c[r] ?? ""), COL_WIDTH)).join("│"));
  }
  return lines.join("\n");
}

# Milestone Hackathon — Kanban AI cho Sale/Marketing (Encore.ts)

> **Quyết định đã chốt (không bàn lại):**
> 1. **Codebase:** Encore.ts mới tinh từ đầu (domain sale/marketing, không dùng repo study-planner cũ).
> 2. **LLM Track:** **Track B** — Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), spawn CLI `claude` đã `claude login` (tài khoản Pro). KHÔNG set `ANTHROPIC_API_KEY`.
> 3. **Scope AI:** đủ cả 3 — (A) Dispatch gán task, (B) Self-serve AI tự làm báo cáo/slide LaTeX, (C) Streaming realtime ra board.
> 4. **Assign:** auto-ghi DB ngay (atomic), board tự đổi cột.
> 5. **Chạy:** localhost (`encore run`), KHÔNG deploy.
> 6. **Thời gian:** ~3–4h, 2 team song song.

---

## 0. Bản đồ tổng quan (đọc cái này trước)

```
        TEAM A — KANBAN (Encore.ts + FE)              TEAM B — ORCHESTRATION (Agent SDK)
  ┌──────────────────────────────────┐         ┌────────────────────────────────────────┐
  │ service: board                   │         │ module: dispatch (chạy độc lập được)    │
  │  - member (title/skills)         │◄────────│  - runDispatch(repo, onProgress)         │
  │  - task   (todo→in_progress→...) │ contract│  - MCP tools: get_todo_tasks /           │
  │  - listTodoTasks / listMembers   │ (types) │    get_members / assign_task /           │
  │  - assignTask (ATOMIC)           │         │    generate_document                     │
  │  - attachArtifact                │         │  - prompt điều phối                      │
  │ FE: board + nút "Start AI"       │         │  - test bằng FakeRepo + seed JSON        │
  └──────────────────────────────────┘         └────────────────────────────────────────┘
                 ▲                                              │
                 └───────────── streamOut WebSocket ───────────┘
                       (Team B host agent trong streamOut handler của ai-engine)
```

**Nguyên tắc vàng để song song:** cả 2 team code theo **1 interface chung `DispatchRepository` + bộ type chung** (§2). Team B **không cần Team A xong mới làm được** — họ test bằng `FakeRepo` đọc seed JSON. Đến giờ tích hợp chỉ việc thay `FakeRepo` → `EncoreRepo`.

---

## 1. Domain model (vì build mới từ đầu — chốt luôn)

Sale/marketing Kanban tối giản. **Bỏ auth phức tạp** (hackathon: hardcode 1 admin hoặc bỏ luôn `auth` để tiết kiệm thời gian; nút Start ai bấm cũng được).

### `member` (thay cho "profile")
| field | type | ví dụ |
|---|---|---|
| id | string (PK) | "m1" |
| name | string | "An" |
| title | string | "Content Writer", "SEO", "Performance Ads", "Designer", "Sales Rep" |
| skills | string[] (JSONB) | ["blog","copywriting"] |
| current_load | int (derived/đếm) | 2 |

### `task` (card Kanban)
| field | type | ghi chú |
|---|---|---|
| id | int (serial PK) | |
| title | string | "Viết blog giới thiệu sản phẩm X" |
| description | string | dùng cho agent phân loại in-scope |
| status | enum | `todo` / `in_progress` / `review` / `done` |
| assignee_id | string \| null | member.id **hoặc** `"ai-agent"` khi AI tự nhận |
| labels | string[] | |
| priority | int | 1..3 |
| artifact_url | string \| null | link PDF khi AI làm xong |
| created_at / updated_at | timestamptz | |

> **In-scope (AI tự làm)** = task yêu cầu **viết báo cáo / làm slide** (vd "report tổng kết tuần", "slide thuyết trình campaign"). Còn lại → dispatch cho người.

### Seed demo cố định (rất quan trọng cho demo ổn định)
- **5 member:** An (Content Writer), Bình (SEO), Chi (Performance Ads), Dũng (Designer), Em (Sales Rep).
- **6 task todo:**
  1. "Viết blog SEO về tính năng mới" → SEO/Content
  2. "Thiết kế banner campaign Tết" → Designer
  3. "Chạy A/B test Facebook Ads" → Performance Ads
  4. "Gọi 20 lead nóng tuần này" → Sales
  5. **"Làm report tổng kết hiệu quả marketing tuần"** → **AI in-scope**
  6. **"Soạn slide pitch cho khách hàng Y"** → **AI in-scope**

---

## 2. ⭐ HỢP ĐỒNG INTERFACE (chốt trong 15' đầu — KHÔNG đổi sau đó)

Đây là **file duy nhất cả 2 team phải đồng ý**. Tạo file `shared/contract.ts`, **cả 2 team copy y hệt**. Bất kỳ thay đổi nào phải báo cả 2 team.

```typescript
// shared/contract.ts  — SINGLE SOURCE OF TRUTH cho cả 2 team
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface Member {
  id: string;
  name: string;
  title: string;          // khóa matching
  skills: string[];
  currentLoad: number;
}

export interface KanbanTask {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;   // member.id | "ai-agent" | null
  labels: string[];
  priority: number;
  artifactUrl: string | null;
}

// Cổng dữ liệu — Team B code theo cái này; Team A cài cái này lên DB thật.
export interface DispatchRepository {
  getTodoTasks(): Promise<KanbanTask[]>;
  getMembers(): Promise<Member[]>;
  /** ATOMIC: chỉ gán khi task còn 'todo'. Trả false nếu đã bị gán. */
  assignTask(taskId: number, assigneeId: string): Promise<boolean>;
  /** AI tự nhận task (assignee="ai-agent", status=in_progress). Atomic, trả false nếu đã bị giữ. */
  claimTask(taskId: number): Promise<boolean>;
  /** Đính PDF + đẩy status (mặc định 'review'). */
  attachArtifact(taskId: number, url: string, status?: TaskStatus): Promise<void>;
}

// Sự kiện đẩy ra FE qua streamOut
export type DispatchEvent =
  | { type: "log"; text: string }                                   // suy luận agent
  | { type: "task_update"; taskId: number; status: TaskStatus; assigneeId: string | null }
  | { type: "artifact"; taskId: number; url: string }
  | { type: "done"; summary: string };
```

**Tool MCP của agent (tên cố định, Team B đặt — Track B dùng `mcp__dispatch__*`):**
`get_todo_tasks`, `get_members`, `assign_task(taskId,memberId,reason)`, `claim_task(taskId)`, `generate_document(taskId,kind,title,latexBody)`.

**Endpoint Team A phải expose (để Team B `~encore/clients` gọi vào):**
| method | path | dùng cho |
|---|---|---|
| GET | `/tasks?status=todo` | `getTodoTasks` |
| GET | `/members` | `getMembers` |
| PATCH | `/tasks/:id/assign` | `assignTask` (atomic) |
| PATCH | `/tasks/:id/claim` | `claimTask` (atomic, assignee="ai-agent") |
| PATCH | `/tasks/:id/artifact` | `attachArtifact` |
| (streamOut) | `/ai/dispatch/stream` | nút Start (Team B viết handler, đặt trong service `ai-engine`) |

---

## 3. Timeline 3–4h (2 track song song + điểm đồng bộ)

```
T+0:00 ─ CÙNG NHAU (15') ─ Chốt §2 contract. Tạo repo Encore, push shared/contract.ts. Cả 2 pull.
        │
        ├── TEAM A (Kanban) ────────────┬── TEAM B (Orchestration) ───────────────
T+0:15  │ Scaffold Encore + migration   │ npm i SDK + verify `claude login` (§6)
        │ member/task + SEED data       │ FakeRepo từ seed JSON + runDispatch khung
T+1:00  │ ── SYNC 1: Team A push endpoint listTodo/listMembers (mock data cũng được) ──
        │ assignTask/claim/artifact      │ MCP tools (get/assign) + prompt
        │ (atomic UPDATE)                │ → TEST standalone vs FakeRepo: assign đúng chưa? (§7)
T+2:00  │ ── SYNC 2: contract khoá cứng, Team A generate Encore client ──
        │ FE board (cột + card) + nút    │ generate_document + tectonic (self-serve) (§5)
        │ Start mở stream                │ onProgress → DispatchEvent
T+3:00  │ ── SYNC 3: TÍCH HỢP ──         │ Thay FakeRepo → EncoreRepo (~encore/clients)
        │ FE consume stream, move card   │ host runDispatch trong streamOut handler
T+3:30  │ ── Hardening + tập demo end-to-end 1 lượt ──
T+4:00  │ DEMO
```

**3 điểm đồng bộ bắt buộc:** SYNC1 (endpoint đọc), SYNC2 (khoá contract + gen client), SYNC3 (ráp stream). Ngoài 3 điểm này, 2 team làm độc lập.

---

## 4. Team A — Kanban (Encore.ts) milestone

### A1 — Scaffold + data (T+0:15 → T+1:00)
- [ ] `encore app create` (hoặc init thủ công), service `board`.
- [ ] `SQLDatabase("board", {migrations})` + migration tạo bảng `members`, `tasks`.
- [ ] Seed §1 (chạy 1 lần lúc khởi động hoặc migration seed).
- [ ] `GET /tasks?status=todo` → trả `KanbanTask[]`; `GET /members` → `Member[]` (đúng shape §2).

### A2 — Endpoint ghi atomic (T+1:00 → T+2:00)
```typescript
// task/assign.ts
export const assignTask = api(
  { expose: true, method: "PATCH", path: "/tasks/:id/assign" },
  async ({ id, memberId }: { id: number; memberId: string }): Promise<{ ok: boolean }> => {
    const row = await db.queryRow`
      UPDATE tasks SET assignee_id = ${memberId}, status = 'in_progress', updated_at = NOW()
      WHERE id = ${id} AND status = 'todo' RETURNING id`;
    return { ok: !!row };          // false = đã bị gán (giống rowcount==0 AutoForge)
  },
);
```
- [ ] `assignTask` (trên), `claimTask` (assignee=`'ai-agent'`), `attachArtifact` (set artifact_url + status).
- [ ] **Generate Encore client** cho Team B: `encore gen client` hoặc team B import `~encore/clients` (nếu cùng monorepo).

> **Quyết định kết hợp repo:** dễ nhất là **1 monorepo Encore duy nhất**, service `board` + service `ai-engine` cùng app → Team B gọi `import { board } from "~encore/clients"` type-safe, KHỎI gen client thủ công. Khuyến nghị cách này.

### A3 — FE board + Start (T+2:00 → T+3:00)
- [ ] Board 4 cột (todo/in_progress/review/done), card hiển thị assignee + nhãn `🤖 AI` nếu `assignee_id==="ai-agent"`.
- [ ] Nút **"Start AI Dispatch"** → mở stream `/ai/dispatch/stream`.
- [ ] Panel log bên phải hiển thị `DispatchEvent.log`; nhận `task_update` → move card; `artifact` → gắn link PDF.

### A4 — Fallback an toàn
- [ ] Nếu stream lỗi: sau khi nhận `done`, **refetch `/tasks`** để board tự cập nhật (bản MVP realtime).

---

## 5. Team B — Orchestration (Agent SDK, Track B) milestone

### B1 — Setup + khung (T+0:15 → T+1:00)
```bash
npm i -g @anthropic-ai/claude-code   # nếu chưa có CLI
claude login                          # tài khoản Pro — verify: claude --version
npm i @anthropic-ai/claude-agent-sdk zod tsx
```
- [ ] `FakeRepo` implement `DispatchRepository` đọc từ `seed.json` (in-memory, `assignTask` set field + trả true).
- [ ] `runDispatch(repo, onProgress)` khung: spawn `query()`, in message ra console.

### B2 — MCP tools + prompt + TEST (T+1:00 → T+2:00) ⭐ trái tim
```typescript
// dispatch/tools.ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DispatchRepository } from "../shared/contract";

export function createDispatchServer(repo: DispatchRepository, log: (s: string) => void) {
  return createSdkMcpServer({
    name: "dispatch", version: "1.0.0",
    tools: [
      tool("get_todo_tasks", "Lấy mọi task status=todo.", {}, async () => {
        const t = await repo.getTodoTasks();
        return { content: [{ type: "text", text: JSON.stringify(t) }] };
      }),
      tool("get_members", "Lấy member kèm title/skills để matching.", {}, async () => {
        const m = await repo.getMembers();
        return { content: [{ type: "text", text: JSON.stringify(m) }] };
      }),
      tool("assign_task", "Gán task cho member phù hợp nhất.",
        { taskId: z.number(), memberId: z.string(), reason: z.string() },
        async (a) => {
          const ok = await repo.assignTask(a.taskId, a.memberId);
          log(ok ? `✓ #${a.taskId} → ${a.memberId} (${a.reason})` : `✗ #${a.taskId} đã bị gán`);
          return { content: [{ type: "text", text: JSON.stringify({ success: ok }) }] };
        }),
      tool("claim_task", "AI TỰ NHẬN task in-scope (báo cáo/slide).",
        { taskId: z.number() },
        async (a) => {
          const ok = await repo.claimTask(a.taskId);
          log(ok ? `🤖 AI nhận #${a.taskId}` : `✗ #${a.taskId} đã bị giữ`);
          return { content: [{ type: "text", text: JSON.stringify({ success: ok }) }] };
        }),
      // generate_document — thêm ở B3
    ],
  });
}
```
```typescript
// dispatch/run.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createDispatchServer } from "./tools";
import type { DispatchRepository } from "../shared/contract";

const PROMPT = `Bạn là điều phối viên team marketing. Quy trình:
1. Gọi get_todo_tasks và get_members.
2. Với mỗi task: nếu nội dung là VIẾT BÁO CÁO hoặc LÀM SLIDE → gọi claim_task(taskId) để AI tự nhận,
   rồi generate_document(...) để tự làm. Ngược lại → gọi assign_task(taskId, memberId, reason)
   chọn member khớp title/skills nhất, cân bằng tải (ưu tiên currentLoad thấp).
3. Nếu tool trả success=false thì bỏ qua task đó (đã bị giữ).
4. Xong thì tóm tắt ngắn ai nhận task gì.`;

export async function runDispatch(repo: DispatchRepository, onLog: (s: string) => void): Promise<string> {
  const server = createDispatchServer(repo, onLog);
  // ❗ Khi dùng custom MCP tools, prompt PHẢI là async generator (streaming input), KHÔNG phải string.
  async function* promptStream() {
    yield { type: "user" as const, message: { role: "user" as const, content: PROMPT } };
  }
  let summary = "Hoàn tất.";
  for await (const msg of query({
    prompt: promptStream(),
    options: {
      model: "claude-sonnet-4-6",       // sonnet nhanh/đỡ quota; đổi claude-opus-4-8 cho bản demo cuối
      maxTurns: 30,
      mcpServers: { dispatch: server },
      allowedTools: [
        "mcp__dispatch__get_todo_tasks", "mcp__dispatch__get_members",
        "mcp__dispatch__assign_task", "mcp__dispatch__claim_task",
        "mcp__dispatch__generate_document",
      ],
      permissionMode: "bypassPermissions", // headless: không treo chờ confirm quyền
      // ❗ KHÔNG set env ANTHROPIC_API_KEY → dùng quota Pro qua CLI đã login
    },
  })) {
    if (msg.type === "assistant") for (const b of (msg as any).message.content)
      if (b.type === "text") onLog(b.text);
    if (msg.type === "result" && (msg as any).subtype === "success") summary = (msg as any).result;
  }
  return summary;
}

// Tham chiếu bộ lab chạy được ngay: ./ai-engine-lab (npm run test:repo / test:tools / test:dispatch ...)
```
- [ ] **TEST ĐỘC LẬP NGAY** (§7) — đây là milestone quan trọng nhất của Team B, làm xong trước khi đụng Encore.

### B3 — Self-serve LaTeX (T+2:00 → T+3:00)
- [ ] Cài + warm-cache `tectonic` (§6). Tạo `templates/report.tex`, `templates/slides.tex` (placeholder `%%TITLE%%`, `%%BODY%%`).
- [ ] Tool `generate_document` (ghép template + body → `tectonic --untrusted` → PDF → `repo.attachArtifact`):
```typescript
tool("generate_document",
  "Tạo PDF báo cáo/slide. Agent CHỈ viết phần thân LaTeX (không \\documentclass). " +
  "Nếu trả error → sửa latexBody và gọi lại.",
  { taskId: z.number(), kind: z.enum(["report","slides"]), title: z.string(), latexBody: z.string() },
  async (a) => {
    try {
      const url = await compileDocument(a.kind, a.title, a.latexBody); // ghép tpl + tectonic
      await repo.attachArtifact(a.taskId, url, "review");
      log(`✓ Tạo ${a.kind} #${a.taskId}: ${url}`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, url }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: String(e).slice(-1200) }) }] };
    }
  })
```
(`compileDocument` = đọc `templates/${kind}.tex`, replace placeholder, `writeFile`, `execFile("tectonic",["--untrusted","--outdir",OUT,tex])`, trả `/artifacts/<base>.pdf`.)
- [ ] `onLog` đẩy thêm `DispatchEvent` (`task_update`/`artifact`) thay vì chỉ text → FE realtime.

### B4 — Tích hợp Encore (T+3:00 → T+3:30)
```typescript
// dispatch/encore-repo.ts — chỉ viết lúc tích hợp; thay FakeRepo
import { board } from "~encore/clients";
import type { DispatchRepository } from "../shared/contract";
export const encoreRepo: DispatchRepository = {
  getTodoTasks: async () => (await board.listTasks({ status: "todo" })).tasks,
  getMembers:   async () => (await board.listMembers()).members,
  assignTask:   async (id, m) => (await board.assignTask({ id, memberId: m })).ok,
  claimTask:    async (id)    => (await board.claimTask({ id })).ok,
  attachArtifact: async (id, url, status) => { await board.attachArtifact({ id, url, status }); },
};
```
- [ ] Host trong `ai-engine` streamOut handler:
```typescript
export const streamDispatch = api.streamOut<{}, DispatchEvent>(
  { expose: true, path: "/ai/dispatch/stream" },
  async (_hs, stream) => {
    const summary = await runDispatch(encoreRepo, (text) => void stream.send({ type: "log", text }));
    await stream.send({ type: "done", summary });
    await stream.close();
  },
);
```

> **Caveat Track B trong Encore:** agent spawn subprocess `claude` (và `tectonic`) → chỉ chạy `encore run` local (đúng yêu cầu). Vì agent chạy lâu (30s–vài phút) → **bắt buộc đặt trong streamOut** (hoặc Pub/Sub subscription), KHÔNG nhét vào API request đồng bộ.

---

## 6. Checklist setup môi trường (làm TRƯỚC khi bắt đầu — cả 2 máy Team B)

```bash
# 1. CLI Claude + login Pro
claude --version
claude login                       # nếu chưa

# 2. Headless stream-json chạy được?
claude -p "trả lời 1 từ: ping" --output-format stream-json
#   → phải thấy dòng JSON "type":"result"

# 3. ĐỪNG để lộ API key (Track B dùng quota Pro)
echo $ANTHROPIC_API_KEY            # phải RỖNG. Nếu có → unset.

# 4. Tectonic (cho self-serve LaTeX) + WARM CACHE trước khi demo
tectonic --version
#   chạy thử compile 1 file .tex mẫu 1 lần → tải package, cache lại (tránh chậm/treo lúc demo live)
```
- [ ] Node 18+, Encore CLI cài sẵn (`encore version`).
- [ ] `tectonic` warm-cache **bắt buộc** (lần đầu tải package vài chục MB, demo live mà chưa cache sẽ treo).

---

## 7. ⭐ Cách TEST ĐỘC LẬP module orchestration (không cần Team A, không deploy)

Đây là phần bạn yêu cầu. Team B kiểm thử **hoàn toàn tách rời** Kanban backend.

### 7.1 Tầng 0 — Verify cơ chế thô (5 phút, §6)
Chạy 4 lệnh §6. Qua hết = SDK + auth Pro OK.

### 7.2 Tầng 1 — Test agent loop bằng `FakeRepo` + seed JSON (KHÔNG cần Encore)
```typescript
// dispatch/fake-repo.ts
import seed from "./seed.json";
import type { DispatchRepository, KanbanTask, Member } from "../shared/contract";
export function makeFakeRepo(): DispatchRepository {
  const tasks: KanbanTask[] = structuredClone(seed.tasks);
  const members: Member[] = structuredClone(seed.members);
  return {
    getTodoTasks: async () => tasks.filter(t => t.status === "todo"),
    getMembers:   async () => members,
    assignTask: async (id, m) => {
      const t = tasks.find(x => x.id === id);
      if (!t || t.status !== "todo") return false;       // ← test ATOMIC: gọi 2 lần lần 2 phải false
      t.assigneeId = m; t.status = "in_progress"; return true;
    },
    claimTask: async (id) => {
      const t = tasks.find(x => x.id === id);
      if (!t || t.status !== "todo") return false;
      t.assigneeId = "ai-agent"; t.status = "in_progress"; return true;
    },
    attachArtifact: async (id, url, status) => {
      const t = tasks.find(x => x.id === id);
      if (t) { t.artifactUrl = url; t.status = status ?? "review"; }
    },
  };
}
```
```typescript
// dispatch/test-local.ts  — chạy: npx tsx dispatch/test-local.ts
import { makeFakeRepo } from "./fake-repo";
import { runDispatch } from "./run";
const repo = makeFakeRepo();
const summary = await runDispatch(repo, (s) => console.log("[agent]", s));
console.log("\n=== SUMMARY ===\n", summary);
console.log("\n=== STATE SAU DISPATCH ===\n", await repo.getTodoTasks()); // phải rỗng/giảm
```
**Kỳ vọng:** 4 task người được gán đúng title (blog→Content/SEO, banner→Designer, ads→Performance, lead→Sales); 2 task report/slide được `claim` + sinh PDF. In `reason` ra để chỉnh prompt.

### 7.3 Tầng 2 — Test self-serve LaTeX riêng lẻ
```typescript
// gọi thẳng compileDocument(), không qua agent
const url = await compileDocument("report", "Test", "\\section{Hello}\\nNội dung thử.");
//   → kiểm tra file .artifacts/report-*.pdf mở được
```

### 7.4 Tầng 3 — Test atomic chống gán trùng
- Gọi `repo.assignTask(5, "m1")` 2 lần → lần 2 trả `false`. (Bảo đảm bấm Start 2 lần không gán đè.)

### 7.5 Bộ matrix test nhanh
| Test | Cách | Pass khi |
|---|---|---|
| Agent gán đúng chuyên môn | `test-local.ts` + đọc reason | banner→Designer, ads→Performance... |
| Phân loại in-scope | task #5,#6 | agent gọi `claim_task` + `generate_document`, KHÔNG `assign_task` |
| Compile LaTeX | `compileDocument` trực tiếp | ra file PDF mở được |
| Self-correct LaTeX | cố tình prompt lỗi cú pháp | agent đọc error → sửa → compile lại |
| Atomic | gọi assign 2 lần | lần 2 = false |
| Quota Pro hoạt động | xem có bị đòi API key không | chạy được, không tốn token API |

> **Toàn bộ §7.1→7.5 chạy được trước khi Team A xong dòng code nào.** Lúc tích hợp chỉ thay `makeFakeRepo()` → `encoreRepo`.

---

## 8. Thang CẮT SCOPE (khi cháy thời gian — luôn có cái để demo)

Ưu tiên từ trên xuống, cắt từ dưới lên:

| Mức | Có gì | Cắt được gì |
|---|---|---|
| **L1 — Must (demo tối thiểu)** | `test-local.ts`: agent đọc FakeRepo → gán đúng + claim → in summary ra terminal | Cắt FE, cắt Encore — demo bằng terminal vẫn cho thấy "AI điều phối" |
| **L2 — Core** | Tích hợp Encore: nút Start → `POST /ai/dispatch/run` (không stream) → board refetch thấy task đã gán | Cắt streaming, cắt LaTeX |
| **L3 — Wow** | + streamOut realtime: card tự nhảy cột, log agent live | Cắt LaTeX nếu tectonic trục trặc |
| **L4 — Full** | + self-serve: task report/slide → AI sinh PDF đính card | — |

**Nếu kẹt:** L1 luôn đạt được chỉ với Team B (độc lập). Đó là lưới an toàn.

---

## 9. Rủi ro & giảm thiểu (Track B + live demo)

| Rủi ro | Giảm thiểu |
|---|---|
| `claude login` hết hạn/sai account lúc demo | Verify §6 sáng hôm demo; có sẵn máy backup đã login |
| Lộ `ANTHROPIC_API_KEY` → tính tiền API | `echo $ANTHROPIC_API_KEY` rỗng; unset trong shell chạy `encore run` |
| Subprocess `claude` lỗi trong Encore | Đã đặt trong streamOut (không phải request đồng bộ); có endpoint `runDispatch` không-stream làm phương án B |
| Tectonic treo (chưa cache) | Warm-cache trước; nếu fail → cắt xuống L3 (bỏ LaTeX) |
| Agent gán lung tung | Prompt rõ + seed data sạch + chỉ 5 tool; `maxTurns: 30` chặn loop |
| 2 team lệch contract | Khoá `shared/contract.ts` ở SYNC2, mọi đổi phải báo cả 2 |
| Bấm Start 2 lần | `assignTask`/`claimTask` atomic `WHERE status='todo'` |

---

## 10. Phân công người (gợi ý, 2 team)

**Team A (2 người):** 1 lo Encore backend (migration + 5 endpoint atomic), 1 lo FE board + nút Start + consume stream.
**Team B (2 người):** 1 lo agent loop + MCP tools + prompt + test FakeRepo (§7), 1 lo self-serve LaTeX (tectonic + template + generate_document) song song, gặp nhau ở B3.

---

## 11. Definition of Done (demo)

- [ ] Bấm "Start AI Dispatch" trên board.
- [ ] Panel hiện log agent suy luận live (streaming).
- [ ] 4 task người: card nhảy sang In Progress kèm tên member đúng chuyên môn.
- [ ] 2 task report/slide: card nhảy In Progress nhãn `🤖 AI` → Review, có link PDF tải được.
- [ ] Bấm Start lần 2: không gán đè (atomic).
- [ ] (Backup) `npx tsx dispatch/test-local.ts` chạy độc lập ra kết quả — luôn có cái để show.

---

### Câu hỏi còn lại (nếu có, trả lời để mình bổ sung — không thì cứ theo file này)
1. **Auth:** bỏ hẳn cho hackathon (ai bấm Start cũng được) — OK chứ? (mình đang giả định BỎ để tiết kiệm thời gian)
2. **Monorepo:** gộp `board` + `ai-engine` cùng 1 app Encore để Team B dùng `~encore/clients` (khuyến nghị) — đồng ý chứ?
3. **Model:** `claude-opus-4-8` (chất) hay `claude-sonnet-4-6` (nhanh/đỡ tốn quota Pro) cho agent? Mình để Opus, đổi 1 dòng là xong.
4. **Member↔assignee của AI:** mình dùng `assignee_id = "ai-agent"` để FE phân biệt card AI — hợp lý chứ?

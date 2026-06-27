# Plan: AI Dispatcher Agent trên Encore.ts (Hackathon)

> **Mục tiêu:** Biến service `ai-engine` (hiện chỉ forward sang n8n) thành **AI Agent nghiệp vụ** — bấm "Start" → quét task `todo` → AI quyết định phân công cho user theo profile → (tùy chọn) xuất báo cáo/slide LaTeX.
>
> Tài liệu này phân tích **độ khả thi tích hợp vào hạ tầng Encore.ts hiện có** + lộ trình triển khai trong 1 ngày. Phần cơ chế Claude SDK chi tiết xem file `AUTOFORGE_CLAUDE_SDK_PORT_TO_TS.md`.

---

## 1. Hiện trạng hạ tầng (đã khảo sát `src/`)

| Thành phần | Trạng thái | Liên quan |
|---|---|---|
| **Framework** | Encore.ts (`encore.dev ^1.57`), monorepo microservice | Mỗi service = `encore.service.ts` + `*.ts` (API qua `api<Req,Res>()`) |
| **`ai-engine`** | Chỉ có 1 endpoint `send` → POST sang n8n webhook, có circuit breaker | **Đây là chỗ ta cắm Agent vào** |
| **`task`** | CRUD task + Postgres (`SQLDatabase`), status `draft/todo/in_progress/review/done`, có `user_id`, `priority`, `subject`, admin endpoints | Nguồn task để quét + đích để ghi assignment |
| **`profile`** | Profile user: `subjects`, `grade`, `weak_topics`, `goals`, `availability`, `planning_preferences` (JSONB) | "Profile" để Agent matching. **Chưa có field `title`/`role`** — xem §6 |
| **`auth`** | better-auth, `getAuthData() → {userID, role}`, role `admin`/`student` | Nút "Start" nên giới hạn `admin` |
| **`firebase`** | Pub/Sub `Topic` (`push-notifications`, at-least-once) | Mẫu async có sẵn; tái dùng cho chạy nền |
| **Khác** | `analytics`, `feedback`, `messenger`, `admin-web` + `student-web` (Next.js) | UI nút "Start" sẽ ở admin-web |
| **Secrets** | `secret("Name")` từ `encore.dev/config`, lưu trong `.secrets.local.cue` | Chỗ để bỏ `AnthropicApiKey` |

> **Lưu ý domain:** App này thực chất là **trợ lý học tập cho học sinh** (grade/subjects/exam), task thuộc sở hữu `user_id`. "Kanban team + assign theo title" cần ánh xạ lại — xem §6 (Gap & giả định).

---

## 2. Phán quyết khả thi (TL;DR)

✅ **KHẢ THI** — nhưng cách tích hợp phụ thuộc 1 quyết định lớn về **auth & runtime** (§4).

- Encore.ts có **đủ primitive** cần thiết: gọi service nội bộ (`~encore/clients`), chạy nền (Pub/Sub `Subscription`), **streaming ra UI** (`api.streamOut` — rất hợp để show agent suy nghĩ live), secrets, cron.
- Cắm Agent vào `ai-engine` là tự nhiên (nó vốn là "AI gateway").
- **Cạm bẫy lớn nhất:** Claude **Agent SDK** (spawn CLI, dùng tài khoản Pro) **không hợp với container deploy** của Encore. Với Encore cloud-native, **gọi thẳng Anthropic API + tool-use loop** mới là fit. Chi tiết §4.

---

## 3. Encore.ts — primitive nào dùng cho Agent (đã verify qua docs)

| Nhu cầu của Agent | Primitive Encore.ts | Ghi chú |
|---|---|---|
| Agent đọc task / profile | **Service-to-service call**: `import { task, profile } from "~encore/clients"` rồi `await task.adminListAll()` | Type-safe, không cần HTTP thủ công |
| Agent ghi assignment | Endpoint mới trong `task` (vd `assign`) gọi qua client | Atomic bằng SQL `UPDATE ... WHERE` |
| Chạy lâu (agent mất 30s–vài phút) | **Pub/Sub `Subscription`** (chạy nền) **hoặc** `api.streamOut` | KHÔNG nên nhét vào 1 API request đồng bộ thường (timeout/UX) |
| Hiện tiến trình lên UI | **`api.streamOut<Handshake, Message>`** | Stream từng dòng "đang gán task X cho Y..." → wow cho demo |
| Khóa API / token | **`secret("AnthropicApiKey")`** | Khai trong `.secrets.local.cue` |
| Chạy định kỳ (nếu cần) | **Cron Jobs** (khai báo) | Ngoài scope hackathon |

```typescript
// Mẫu gọi service nội bộ (Encore tự sinh client)
import { task, profile } from "~encore/clients";
const { tasks } = await task.adminListAll({ limit: 100 });
const { profiles } = await profile.adminList();
```

```typescript
// Mẫu streamOut để bắn tiến trình agent ra admin-web
export const dispatchStream = api.streamOut<{ boardId?: string }, { line: string }>(
  { path: "/ai/dispatch/stream", expose: true /* auth: true */ },
  async (_hs, stream) => {
    await stream.send({ line: "Đang quét task todo..." });
    // ... chạy agent, mỗi bước stream.send({ line })
    await stream.close();
  },
);
```

---

## 4. ⭐ Quyết định kiến trúc: Agent SDK (Pro) vs Anthropic API (key)

Đây là điểm quan trọng nhất phải chốt trước khi code.

| Tiêu chí | **Track A — Anthropic API + tool-use loop** | **Track B — Claude Agent SDK (spawn CLI, Pro account)** |
|---|---|---|
| Thư viện | `@anthropic-ai/sdk` | `@anthropic-ai/claude-agent-sdk` (spawn `claude` CLI) |
| Auth | API key qua `secret()` | OAuth login `claude login` (gói Pro) |
| Chi phí | Trả token (demo rất rẻ, ~vài cent) | "Miễn phí" trong quota Pro |
| Chạy trong Encore service | ✅ Gọn — chỉ là HTTP client, không subprocess | ⚠️ Phải spawn child process `claude` + có binary trong container |
| Deploy Encore (Docker) | ✅ Hợp hoàn toàn (cloud-native) | ❌ Container không có `~/.claude` credential → **chỉ chạy local `encore run`** |
| "Tools" = đọc/ghi task | Function-calling → gọi `~encore/clients` | MCP in-process tool → gọi `~encore/clients` |
| Rủi ro fail khi demo live | Thấp | Cao hơn (subprocess, auth, môi trường) |

### Khuyến nghị: **Track A cho hackathon.**
Lý do: live demo **không được fail**, mà Track A khớp đúng mô hình Encore (không subprocess, deploy được, auth bằng secret). Nghiệp vụ "đọc task → quyết định → ghi assignment → xuất file" **bản chất là tool-use loop**, KHÔNG cần filesystem/bash của Agent SDK. Token cho 1 lần dispatch demo cực rẻ.

> **Cập nhật (chạy localhost):** vì chỉ demo trên máy local (`encore run`), rào cản "container không có credential/binary" **không còn**. Do đó:
> - **Track B (Agent SDK + Pro) cũng chạy được** nếu bạn muốn xài quota Pro — máy đã `claude login`.
> - **LaTeX/Tectonic compile** (spawn subprocess) **chạy thoải mái** trên localhost (xem §14).
> - Mình vẫn nghiêng Track A vì code gọn & ổn định hơn, nhưng giờ là lựa chọn tự do. Cả 2 dùng chung bộ tool nên đổi qua lại dễ.

> **Track B** chỉ chọn nếu: (a) bắt buộc xài quota Pro vì lý do chi phí, **và** (b) chấp nhận demo chạy **local** (`encore run`) trên máy đã `claude login`. Khi đó nhét Agent SDK vào 1 Pub/Sub subscription (chạy nền), không nhét vào request đồng bộ. Code MCP tool tái dùng từ file `AUTOFORGE_CLAUDE_SDK_PORT_TO_TS.md`.

**Điểm hay:** cả 2 track dùng **cùng bộ "tool"** (đọc task, đọc profile, assign, gen report). Chỉ khác lớp gọi LLM. Nên có thể bắt đầu Track A, sau hackathon đổi sang B nếu muốn — logic nghiệp vụ không phải viết lại.

---

## 5. Kiến trúc đề xuất (Track A)

```
[admin-web: nút "Start Dispatch"]
        │  WebSocket → api.streamOut("/ai/dispatch/stream")
        ▼
┌─────────────────────────────────────────────┐
│  ai-engine service  (Encore.ts)             │
│  ┌───────────────────────────────────────┐  │
│  │ dispatchAgent()  — tool-use loop       │  │
│  │  Anthropic API (secret key)            │  │
│  └───┬───────────────┬──────────────┬─────┘  │
│      │ tool          │ tool         │ tool    │
└──────┼───────────────┼──────────────┼─────────┘
       │               │              │
  ~encore/clients  ~encore/clients   (LaTeX/Tectonic
       ▼               ▼               hoặc bỏ qua ở MVP)
 ┌──────────┐    ┌───────────┐   ┌──────────────┐
 │ task svc │    │ profile   │   │ generate_doc │
 │ list/    │    │ adminList │   │ (báo cáo PDF)│
 │ assign   │    └───────────┘   └──────────────┘
 └────┬─────┘
      │ UPDATE tasks (atomic)
      ▼
 [stream.send từng dòng → admin-web hiển thị live]
```

**Tool-use loop (lõi):**
1. Gửi system prompt + danh sách tool cho Anthropic API.
2. Model trả `stop_reason: "tool_use"` → thực thi tool tương ứng (gọi Encore service) → đẩy `tool_result` lại.
3. Lặp tới khi `stop_reason: "end_turn"` → model đã assign xong + trả tóm tắt.
4. Mỗi vòng `stream.send()` ra UI để demo "thấy agent đang nghĩ".

---

## 6. Gap dữ liệu & giả định (cần chốt trước khi code)

1. **Profile chưa có `title`/`role` nghề nghiệp.** App đang là study-planner. Hai lựa chọn:
   - **(MVP nhanh)** Matching theo field sẵn có: `subjects`, `grade`, `weak_topics`, `availability`. Agent gán task cho học sinh có `subject` khớp + còn `availability`.
   - **(Team-Kanban thật)** Thêm migration `profile`: cột `title TEXT` (vd "Frontend", "Content", "SEO"). Agent gán theo title. ~5 phút thêm migration + field.
2. **"Assign" nghĩa là gì trong model task?** Task hiện có `user_id` = chủ sở hữu. Hai cách:
   - Reuse `user_id` làm người được giao (đơn giản nhất).
   - Thêm cột `assignee_id TEXT` nếu cần tách "người tạo" vs "người làm".
3. **Atomic khi gán** (tránh gán trùng nếu chạy nhiều lần): endpoint `assign` phải `UPDATE tasks SET user_id=$u WHERE id=$id AND status='todo'` rồi check `rowCount` (giống pattern AutoForge `feature_claim_and_get`).
4. **Báo cáo/slide LaTeX:** Tectonic spawn subprocess — **trên localhost chạy bình thường** (xem §14). Đây là nghiệp vụ **in-scope** của AI (§12). Cần chuẩn bị: cài binary `tectonic` trên máy demo + có thư mục `templates/`.

> ⚠️ **Cần bạn xác nhận:** dùng matching theo `subjects` (MVP) hay thêm field `title` cho đúng kịch bản team-Kanban?

---

## 7. Lộ trình triển khai (ưu tiên cho 1 ngày)

### Phase 0 — Chuẩn bị (~20 phút)
- [ ] `cd src && npm i @anthropic-ai/sdk`
- [ ] Thêm secret: `encore secret set --type local AnthropicApiKey` (+ khai trong `.secrets.local.cue`)
- [ ] Chốt §6: matching theo `subjects` hay thêm `title`; assign vào `user_id`.

### Phase 1 — Tool layer (~1h) — *làm trước, test được ngay*
- [ ] `task`: thêm endpoint `assignToUser` (atomic UPDATE, admin-only) + đảm bảo `adminListAll` lọc được `status=todo`.
- [ ] `profile`: dùng `adminList` sẵn có (đã trả mọi profile).
- [ ] Viết module `ai-engine/tools.ts`: 3 hàm thuần `getTodoTasks()`, `getCandidates()`, `assign(taskId,userId)` — gọi `~encore/clients`. Test bằng `encore run` + curl.

### Phase 2 — Agent loop (~1.5h) — *trái tim*
- [ ] `ai-engine/dispatch.ts`: tool-use loop với Anthropic API (code §8).
- [ ] Endpoint `POST /ai/dispatch/run` (admin-only) chạy loop, trả summary JSON.
- [ ] Test: tạo vài task `todo` + vài profile khác subject → chạy → kiểm tra assignment đúng.

### Phase 3 — Streaming UI (~1h) — *điểm ăn tiền khi demo*
- [ ] Đổi/bổ sung `api.streamOut` `/ai/dispatch/stream` để bắn từng bước.
- [ ] admin-web: nút "Start Dispatch" + panel hiện log stream + refresh board sau khi xong.

### Phase 4 — Báo cáo (nếu còn thời gian) — *nice-to-have*
- [ ] Tool `generate_report`: với Track A, làm bản **Markdown→HTML** (không subprocess) cho an toàn deploy; LaTeX/Tectonic để sau. Xem `AUTOFORGE_CLAUDE_SDK_PORT_TO_TS.md` §11.
- [ ] Đính link báo cáo vào task hoặc trả URL.

### Phase 5 — Demo hardening (~30 phút)
- [ ] Seed data demo cố định (5 task todo + 4 profile).
- [ ] Bọc try/catch + fallback message, giới hạn `max tool iterations` (vd 25).
- [ ] Tập demo 1 lượt end-to-end.

---

## 8. Code skeleton (Track A — copy & sửa)

### 8.1 `task` — endpoint assign atomic
```typescript
// task/task.ts  (thêm vào)
export interface AssignParams { id: number; userId: string }

export const assignToUser = api(
  { expose: true, auth: true, method: "PATCH", path: "/api/admin/tasks/:id/assign" },
  async ({ id, userId }: AssignParams): Promise<Task> => {
    requireAdmin();
    // Atomic: chỉ gán khi còn 'todo' (chống gán trùng giữa các lần chạy)
    const row = await db.queryRow<Task>`
      UPDATE tasks SET user_id = ${userId}, status = 'in_progress', updated_at = NOW()
      WHERE id = ${id} AND status = 'todo'
      RETURNING id, title, subject, duration_min, priority, rationale, status,
        description, due_date::text AS due_date, start_time::text AS start_time,
        end_time::text AS end_time, color, source,
        first_started_at::text AS first_started_at, user_id,
        created_at::text AS created_at, updated_at::text AS updated_at
    `;
    if (!row) throw APIError.failedPrecondition("task không còn ở trạng thái todo");
    return rowToTask(row);
  },
);
```

### 8.2 `ai-engine/dispatch.ts` — tool-use loop
```typescript
import { api, APIError } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { getAuthData } from "~encore/auth";
import { task, profile } from "~encore/clients";
import Anthropic from "@anthropic-ai/sdk";

const anthropicKey = secret("AnthropicApiKey");

// ── Định nghĩa tool cho model ──────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  { name: "get_todo_tasks", description: "Lấy mọi task đang ở trạng thái todo.",
    input_schema: { type: "object", properties: {} } },
  { name: "get_candidates", description: "Lấy danh sách user kèm subjects/grade/weak_topics để matching.",
    input_schema: { type: "object", properties: {} } },
  { name: "assign_task", description: "Gán 1 task cho 1 user phù hợp nhất.",
    input_schema: { type: "object",
      properties: { taskId: { type: "number" }, userId: { type: "string" }, reason: { type: "string" } },
      required: ["taskId", "userId", "reason"] } },
];

// ── Thực thi tool → gọi service Encore ─────────────────────
async function runTool(name: string, input: any, log: (s: string) => void): Promise<string> {
  if (name === "get_todo_tasks") {
    const { tasks } = await task.adminListAll({ limit: 100 });
    const todo = tasks.filter((t) => t.status === "todo")
      .map((t) => ({ id: t.id, title: t.title, subject: t.subject, priority: t.priority }));
    log(`Tìm thấy ${todo.length} task todo`);
    return JSON.stringify(todo);
  }
  if (name === "get_candidates") {
    const { profiles } = await profile.adminList();
    const cands = profiles.map((p) => ({
      userId: p.user_id, name: p.full_name, grade: p.grade,
      subjects: p.subjects, weak_topics: p.weak_topics,
    }));
    return JSON.stringify(cands);
  }
  if (name === "assign_task") {
    try {
      await task.assignToUser({ id: input.taskId, userId: input.userId });
      log(`✓ Gán task #${input.taskId} → ${input.userId} (${input.reason})`);
      return JSON.stringify({ success: true });
    } catch (e) {
      log(`✗ Task #${input.taskId} gán lỗi: ${String(e)}`);
      return JSON.stringify({ success: false, error: String(e) });
    }
  }
  return JSON.stringify({ error: "unknown tool" });
}

const SYSTEM = `Bạn là điều phối viên. Hãy:
1. Gọi get_todo_tasks và get_candidates.
2. Với mỗi task, chọn user phù hợp nhất theo môn học/điểm yếu khớp nội dung task; cân bằng tải.
3. Gọi assign_task cho từng phân công. Nếu success=false thì bỏ qua task đó.
4. Khi xong, tóm tắt ngắn gọn ai nhận task gì.`;

// ── Loop dùng chung cho cả endpoint thường & stream ────────
async function dispatchAgent(log: (s: string) => void): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicKey() });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Bắt đầu phân công toàn bộ task todo." },
  ];

  for (let i = 0; i < 25; i++) {                 // chặn vòng lặp vô hạn
    const resp = await client.messages.create({
      model: "claude-sonnet-4-5",                // nhanh/rẻ cho demo; đổi opus nếu cần
      max_tokens: 2048,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      const text = resp.content.find((b) => b.type === "text");
      return text && "text" in text ? text.text : "Hoàn tất.";
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        const out = await runTool(block.name, block.input, log);
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return "Đạt giới hạn số bước.";
}

function requireAdmin() {
  const auth = (getAuthData as () => { role: string } | null)();
  if (!auth || auth.role !== "admin") throw APIError.permissionDenied("admin only");
}

// ── Endpoint thường (đơn giản) ─────────────────────────────
export const runDispatch = api(
  { expose: true, auth: true, method: "POST", path: "/ai/dispatch/run" },
  async (): Promise<{ summary: string }> => {
    requireAdmin();
    const summary = await dispatchAgent((s) => console.log("[dispatch]", s));
    return { summary };
  },
);

// ── Endpoint streaming (demo đẹp) ──────────────────────────
export const streamDispatch = api.streamOut<{}, { line: string }>(
  { expose: true, auth: true, path: "/ai/dispatch/stream" },
  async (_hs, stream) => {
    const summary = await dispatchAgent((s) => { void stream.send({ line: s }); });
    await stream.send({ line: "── SUMMARY ──\n" + summary });
    await stream.close();
  },
);
```

> Lưu ý: kiểm tra signature `api.streamOut`/`secret` theo version `encore.dev` đang cài (1.57); tên field `block.input` của Anthropic SDK trả `unknown` → ép kiểu khi đọc.

---

## 9. Rủi ro & giảm thiểu (cho live demo)

| Rủi ro | Giảm thiểu |
|---|---|
| Agent gán lung tung | Prompt rõ + chỉ expose 3 tool + seed data sạch để demo ổn định |
| Vòng lặp tool vô hạn | Giới hạn 25 bước (đã có trong code) |
| API key lỗi/hết hạn | Verify `encore secret` trước; có fallback message |
| LaTeX/Tectonic fail trên cloud | Để Phase 4, bản MVP dùng Markdown→HTML; LaTeX chạy local |
| `streamOut` lạ với team | Có sẵn endpoint `runDispatch` không-stream làm phương án B |
| Race khi bấm Start 2 lần | `assign` atomic `WHERE status='todo'` → lần 2 không gán lại |

---

## 10. Scope tối thiểu để "có cái demo" (nếu kẹt thời gian)

**Must-have (Phase 0–2):** nút Start → `POST /ai/dispatch/run` → agent đọc task+profile, gán bằng `assign_task`, trả summary. Board refresh thấy task đã có người.

**Cắt được:** streaming (dùng endpoint thường), báo cáo/slide LaTeX, field `title` (matching tạm bằng `subjects`).

---

## 11. Việc cần bạn quyết (để mình code tiếp)

1. **Matching theo `subjects`/`grade` (nhanh) hay thêm field `title` cho team-Kanban?** (§6.1)
2. **Assign vào `user_id` sẵn có hay thêm `assignee_id`?** (§6.2)
3. **Track A (API key, khuyến nghị) hay Track B (Pro account, local-only)?** (§4)
4. Có cần báo cáo/slide ngay trong hackathon, hay để sau?

> Trả lời 4 câu trên là mình có thể viết thẳng code Phase 1–2 vào repo.

---

## 12. Hai nghiệp vụ của AI Agent (Dispatch vs Self-serve)

AI vừa là **người điều phối** vừa là **một "member" trên board** tự nhận việc. Trong 1 lần bấm "Start", agent xử lý mỗi task `todo` theo 1 trong 2 hướng:

| | **A. Dispatch (gán cho người)** | **B. Self-serve / in-scope (AI tự làm)** |
|---|---|---|
| Khi nào | Task cần con người (ngoài khả năng AI) | Task **nằm trong tầm AI** = viết **báo cáo / slide LaTeX** |
| Hành động | `assign_task(taskId, userId)` → set `user_id`, `status=in_progress` | `claim_task(taskId)` → set assignee = **AI**, `status=in_progress` → **tự sinh tài liệu** → đính artifact → `status=review`(hoặc `done`) |
| Ai làm tiếp | User người thật | Không ai — AI làm xong luôn |
| FE cần | Card đổi người + đổi cột | Card nhảy `in_progress` ngay lúc AI nhận, rồi `review`/`done` khi xong + hiện link PDF |

### Agent tự quyết "in-scope" bằng cách nào
Cho agent **1 tool phân loại + 2 nhánh hành động**. Trong prompt định nghĩa rõ "in-scope":

```
Một task là IN-SCOPE nếu nội dung yêu cầu tạo BÁO CÁO hoặc SLIDE (vd: "viết report tổng kết",
"làm slide thuyết trình tuần", "tổng hợp số liệu ra PDF").
- Nếu IN-SCOPE: gọi claim_task(taskId) để TỰ NHẬN, rồi generate_document(...) để tự làm.
- Nếu KHÔNG in-scope: gọi assign_task(taskId, userId) để giao cho người phù hợp nhất.
```

### Vòng đời task khi AI tự nhận (state machine)
```
todo ──claim_task()──► in_progress (assignee=AI)
                           │ generate_document() chạy (Tectonic compile)
                           ├─ thành công ─► review (đính link PDF)  ──(người duyệt)──► done
                           └─ compile lỗi ─► agent tự sửa latexBody & thử lại (tối đa N lần)
```

> **Tool mới cần thêm** so với §8: `claim_task(taskId)` (atomic, assignee=AI) và `generate_document(taskId, kind, templateId, latexBody)` (§14). Bộ tool đầy đủ của agent: `get_todo_tasks`, `get_candidates`, `assign_task`, `claim_task`, `generate_document`.

---

## 13. Cập nhật realtime ra FE (Pub/Sub → cầu nối → trình duyệt)

**Điểm kỹ thuật quan trọng:** Encore Pub/Sub `Topic` (như `push-notifications` đang có) là async **giữa các service backend** (SNS/SQS) — **trình duyệt KHÔNG subscribe trực tiếp được**. Phải có **cầu nối** đẩy sự kiện ra FE. Hai cách:

| Cách | Cơ chế | Hợp khi |
|---|---|---|
| **(1) `api.streamOut` WebSocket** ⭐ | FE mở 1 stream tới `/ai/dispatch/stream`; backend `stream.send()` mỗi khi task đổi trạng thái | Demo dispatch (FE đang xem panel agent chạy). Đơn giản nhất, đã có ở §8.2 |
| **(2) Firebase FCM / Firestore** | App **đã có** `firebase` service + topic `pushNotifications`. Publish event → subscription → FCM push → FE | Khi muốn cập nhật cả lúc FE không mở panel; tái dùng hạ tầng sẵn có |

### Luồng khuyến nghị (kết hợp Pub/Sub nội bộ + streamOut ra FE)
```
AI claim_task(#5)
   │
   ├─ task svc: UPDATE status=in_progress, assignee=AI   (atomic)
   ├─ publish Topic "task-events" { taskId:5, status:"in_progress", actor:"AI" }   ← async nội bộ
   └─ stream.send({ type:"task_update", taskId:5, status:"in_progress" })          ← ra FE ngay

FE (admin-web / board):
   for await (msg of stream)  → cập nhật card #5 sang cột In Progress, gắn nhãn "🤖 AI"
```

### Định nghĩa Topic sự kiện task (tái dùng pattern `firebase/events.ts`)
```typescript
// task/events.ts
import { Topic } from "encore.dev/pubsub";
export interface TaskEvent {
  taskId: number;
  status: "todo" | "in_progress" | "review" | "done";
  actor: "AI" | string;      // userId hoặc "AI"
  artifactUrl?: string;       // link PDF khi xong
}
export const taskEvents = new Topic<TaskEvent>("task-events", { deliveryGuarantee: "at-least-once" });
```

### FE tiêu thụ stream (admin-web, dùng client Encore generate)
```typescript
// Encore sinh client type-safe (npm run gen). Mở stream và cập nhật board.
const stream = client.aiEngine.streamDispatch();
for await (const msg of stream) {
  if (msg.type === "task_update") moveCardToColumn(msg.taskId, msg.status, msg.actor);
  else appendLog(msg.line);   // log suy luận agent
}
```

> **MVP an toàn:** nếu kẹt, FE chỉ cần **refetch danh sách task** sau khi stream gửi `done` → board tự cập nhật. Realtime từng-card là bản nâng cấp.

---

## 14. Nghiệp vụ Template LaTeX (FE chọn / đổi template)

AI chỉ sinh **phần thân** LaTeX; **template** (preamble, branding, layout) do bạn quản lý → FE cho **chọn template** hoặc **đổi/tùy biến template**. (Nguyên tắc 2 pha & code tool xem `AUTOFORGE_CLAUDE_SDK_PORT_TO_TS.md` §11.)

### 14.1 Data model template
```typescript
// document service (mới) — hoặc nhét tạm vào ai-engine cho hackathon
export interface DocTemplate {
  id: string;            // "report-default", "slides-blue"
  name: string;          // hiển thị ở FE
  kind: "report" | "slides";
  tex: string;           // .tex có placeholder %%TITLE%% và %%BODY%%
  isDefault: boolean;
}
```
Lưu ở: **bảng Postgres** `doc_templates` (cho phép FE CRUD/đổi) **hoặc** file trong `templates/*.tex` (nhanh hơn, nhưng "đổi template" thì cần ghi file). Hackathon: **bảng Postgres** để FE đổi được ngay.

### 14.2 Nghiệp vụ FE
1. **Chọn template:** màn tạo báo cáo có dropdown "Mẫu" → list `GET /templates?kind=report`.
2. **Đổi/tùy biến:** nút "Sửa mẫu" mở editor `.tex` (hoặc upload file) → `PUT /templates/:id`. Cho phép tạo bản sao để không phá mẫu gốc.
3. **Sinh tài liệu:** khi AI tự nhận task in-scope, nó gọi `generate_document(taskId, kind, templateId, latexBody)`; nếu task của user chỉ định template riêng thì truyền `templateId` đó, không thì dùng `isDefault`.

### 14.3 Endpoint + tool (localhost → Tectonic chạy trực tiếp)
```typescript
// document/document.ts  (rút gọn)
import { api } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const run = promisify(execFile);
const db = new SQLDatabase("document", { migrations: "./migrations" });
const OUT_DIR = "./.artifacts";   // serve qua static hoặc 1 endpoint download

export const listTemplates = api(
  { expose: true, auth: true, method: "GET", path: "/templates" },
  async ({ kind }: { kind?: string }): Promise<{ templates: DocTemplate[] }> => { /* SELECT ... */ },
);

export const upsertTemplate = api(
  { expose: true, auth: true, method: "PUT", path: "/templates/:id" },
  async (t: DocTemplate): Promise<DocTemplate> => { /* INSERT ... ON CONFLICT UPDATE */ },
);

// Hàm dùng chung — agent tool gọi vào đây
export async function compileDocument(kind: "report"|"slides", templateId: string, title: string, latexBody: string): Promise<string> {
  const tpl = await db.queryRow<{ tex: string }>`SELECT tex FROM doc_templates WHERE id = ${templateId}`;
  if (!tpl) throw new Error("template not found");
  await mkdir(OUT_DIR, { recursive: true });
  const base = `${kind}-${Date.now()}`;
  const tex = tpl.tex.replace("%%TITLE%%", title).replace("%%BODY%%", latexBody);
  await writeFile(join(OUT_DIR, `${base}.tex`), tex);
  // --untrusted vì LaTeX do LLM sinh; localhost nên Tectonic chạy ổn
  await run("tectonic", ["--untrusted", "--outdir", OUT_DIR, join(OUT_DIR, `${base}.tex`)], { timeout: 60_000 });
  return `/artifacts/${base}.pdf`;
}
```

### 14.4 Nối vào agent (tool `generate_document`)
Bổ sung vào `runTool()` ở §8.2:
```typescript
if (name === "generate_document") {
  try {
    const url = await compileDocument(input.kind, input.templateId ?? `${input.kind}-default`, input.title, input.latexBody);
    // đính vào task + đẩy review + bắn event ra FE
    await task.attachArtifact({ id: input.taskId, url, status: "review" });
    log(`✓ Tạo ${input.kind} cho task #${input.taskId}: ${url}`);
    return JSON.stringify({ success: true, url });
  } catch (e) {
    log(`✗ Compile lỗi task #${input.taskId} — agent sẽ sửa LaTeX`);
    return JSON.stringify({ success: false, error: String(e).slice(-1200) });  // agent tự fix & gọi lại
  }
}
```

### 14.5 Chuẩn bị cho demo
- [ ] Cài `tectonic` trên máy demo (`brew`/scoop/release binary) — lần chạy đầu tải package, nên **chạy thử trước 1 lần** để cache (tránh chậm khi demo live).
- [ ] Seed 2 template mặc định: `report-default` (article), `slides-default` (beamer) — kèm `%%TITLE%%`/`%%BODY%%`.
- [ ] Endpoint `/artifacts/*` để FE tải PDF (static serve hoặc `api.raw` stream file).

---

## 15. Cập nhật lộ trình & việc cần chốt (bổ sung)

Thêm vào Phase (sau §7):
- **Phase 2b — Self-serve in-scope:** tool `claim_task` + nhánh phân loại in-scope trong prompt.
- **Phase 3b — Realtime card update:** Topic `task-events` + `stream.send({type:"task_update"})` + FE move card.
- **Phase 4 (nâng cấp):** đổi từ "Markdown→HTML" sang **template LaTeX + Tectonic** (vì localhost cho phép) + FE chọn/đổi template (§14).

Câu hỏi bổ sung cần bạn chốt:
5. **assignee của AI lưu thế nào?** (vd `user_id = "ai-agent"` hay cột `assignee_type='ai'`) để FE phân biệt card AI nhận.
6. **Task xong AI đẩy `review` (cần người duyệt) hay `done` luôn?**
7. **Template lưu DB (FE đổi được) hay file tĩnh (nhanh hơn)?** — khuyến nghị DB vì bạn cần nghiệp vụ "đổi template".
8. **Realtime: `streamOut` WebSocket (gọn) hay Firebase FCM (đã có sẵn)?**

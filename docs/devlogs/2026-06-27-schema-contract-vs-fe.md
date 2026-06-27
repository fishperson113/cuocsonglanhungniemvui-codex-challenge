# Devlog — Reconcile schema FE/backend ↔ contract của orchestration

> **Ngày:** 2026-06-27
> **Bối cảnh:** FE gần xong. Schema thực tế (FE/backend) có thể **không đầy đủ** như `ai-engine/dispatch/contract.ts` mình đã định nghĩa. Devlog này ghi cách map nhanh để sau này khỏi mò.

---

## 1. Nguyên tắc vàng (đọc cái này là đủ)

> **Agent KHÔNG chạm schema thật. Mọi khác biệt được hấp thụ ở 1 lớp adapter (`EncoreRepo`), KHÔNG sửa agent/tools/prompt.**

```
   schema thật (FE/backend)          adapter (map field)            contract của agent
   ┌──────────────────────┐         ┌──────────────────┐          ┌────────────────────┐
   │ /tasks, /members ...  │  ───►   │ EncoreRepo        │  ───►   │ DispatchRepository │
   │ (tên field tuỳ FE)    │         │ (đổi tên/đổ default)│        │ (cố định)          │
   └──────────────────────┘         └──────────────────┘          └────────────────────┘
```

→ FE đặt tên field khác, thiếu field, gộp bảng... đều chỉ sửa **trong `EncoreRepo`**. Agent, `tools.ts`, prompt, `expected.json` **không đổi một dòng**.

---

## 2. ⭐ Field nào agent THỰC SỰ cần (phần quan trọng nhất)

Không phải field nào trong contract cũng ngang nhau. Phân loại theo mức agent dùng:

### `KanbanTask`
| Field | Mức | Agent dùng để làm gì | FE thiếu thì sao |
|---|---|---|---|
| `id` | 🔴 BẮT BUỘC | định danh để gán/claim | Không chạy được |
| `title` | 🔴 BẮT BUỘC | tín hiệu chính để matching + phân loại in-scope | Matching mù |
| `description` | 🟡 NÊN CÓ | phân loại in-scope (report/slide) chính xác hơn | Vẫn chạy, phân loại dựa mỗi title |
| `status` | 🔴 BẮT BUỘC | lọc `todo` | Không biết task nào cần gán |
| `assigneeId` | 🟢 OUTPUT | mình GHI vào, không đọc để quyết | — |
| `labels` | ⚪ KHÔNG CẦN | (hiện chưa dùng trong prompt) | Bỏ được |
| `priority` | ⚪ TUỲ | có thể dùng để ưu tiên thứ tự gán | Bỏ được |
| `artifactUrl` | 🟢 OUTPUT (Phase 4) | đính PDF khi AI làm xong | — |

### `Member`
| Field | Mức | Agent dùng để làm gì | FE thiếu thì sao |
|---|---|---|---|
| `id` | 🔴 BẮT BUỘC | gán task vào | Không chạy được |
| `title` | 🔴 BẮT BUỘC | **khoá matching chính** (vd "Designer") | Matching kém hẳn |
| `skills` | 🟡 NÊN CÓ | matching tinh hơn theo kỹ năng | Vẫn chạy bằng title |
| `name` | ⚪ HIỂN THỊ | log/summary cho người đọc | Hiện id thay tên |
| `currentLoad` | 🟡 NÊN CÓ | cân bằng tải (tiebreak khi nhiều người hợp) | Bỏ cân tải, vẫn gán đúng nghề |

**Tóm lại — "minimum viable contract" để agent chạy có ý nghĩa:**
- Task: `id`, `title`, `status`
- Member: `id`, `title` (hoặc `skills`)

Mọi field 🟡/⚪ thiếu → agent vẫn chạy, chỉ giảm chất lượng. FE cứ giao đủ 🔴 là demo được.

---

## 3. Adapter pattern — chỗ hấp thụ khác biệt

Khi biết schema FE thật, chỉ viết `EncoreRepo` map vào. Ví dụ FE đặt tên khác / thiếu field:

```typescript
// ai-engine/dispatch/encore-repo.ts  (Phase 4)
import { board } from "~encore/clients";
import type { DispatchRepository, KanbanTask, Member } from "./contract.ts";

export const encoreRepo: DispatchRepository = {
  getMembers: async () => {
    const { members } = await board.listMembers();
    return members.map((m): Member => ({
      id: m.id,
      name: m.name ?? m.id,                 // FE thiếu name → fallback id
      title: m.role ?? m.title ?? "",       // FE gọi là "role" → map sang "title"
      skills: m.skills ?? [],               // FE thiếu skills → mảng rỗng
      currentLoad: m.taskCount ?? 0,        // FE tính kiểu khác → đổ default
    }));
  },
  getTodoTasks: async () => {
    const { tasks } = await board.listTasks({ status: "todo" });
    return tasks.map((t): KanbanTask => ({
      id: t.id,
      title: t.title,
      description: t.desc ?? "",             // FE gọi "desc"
      status: t.status,
      assigneeId: t.assignee ?? null,
      labels: t.tags ?? [],                 // FE gọi "tags"
      priority: t.priority ?? 2,
      artifactUrl: t.fileUrl ?? null,
    }));
  },
  assignTask: async (id, memberId) => (await board.assign({ id, memberId })).ok,
  claimTask:  async (id) => (await board.claim({ id })).ok,
  attachArtifact: async (id, url, status) => { await board.attachArtifact({ id, url, status }); },
};
```

→ Toàn bộ "schema không khớp" sống ở đây. Agent không biết và không cần biết.

---

## 4. Checklist reconcile nhanh (dùng mỗi khi có schema mới)

Khi FE chốt schema, làm đúng các bước này (~10 phút):

- [ ] Lấy shape thật của FE: response `/members` và `/tasks` (paste JSON mẫu).
- [ ] Điền **bảng mapping** ở §5 (field thật → field contract).
- [ ] Field 🔴 BẮT BUỘC mà FE **không có** → báo FE bổ sung HOẶC chốt giá trị default chấp nhận được.
- [ ] Viết/cập nhật `encore-repo.ts` theo mapping.
- [ ] Chạy `npm test` với `FakeRepo` (không đổi) để chắc agent vẫn pass — rồi mới đổi sang `encoreRepo`.
- [ ] Nếu đổi tên status (`todo/in_progress/...`) khác phía FE → map trong adapter, KHÔNG sửa `TaskStatus`.

---

## 5. Bảng mapping (điền khi có schema FE thật)

> Để trống, điền lúc tích hợp.

### Member
| Field contract | Mức | Field FE tương ứng | Default nếu thiếu |
|---|---|---|---|
| `id` | 🔴 | | — |
| `title` | 🔴 | | `""` |
| `skills` | 🟡 | | `[]` |
| `name` | ⚪ | | `= id` |
| `currentLoad` | 🟡 | | `0` |

### KanbanTask
| Field contract | Mức | Field FE tương ứng | Default nếu thiếu |
|---|---|---|---|
| `id` | 🔴 | | — |
| `title` | 🔴 | | — |
| `description` | 🟡 | | `""` |
| `status` | 🔴 | | — |
| `assigneeId` | 🟢 | | `null` |
| `labels` | ⚪ | | `[]` |
| `priority` | ⚪ | | `2` |
| `artifactUrl` | 🟢 | | `null` |

---

## 6. Quyết định đã chốt
- Contract `ai-engine/dispatch/contract.ts` là **source of truth của orchestration**, KHÔNG chạy theo FE.
- Khác biệt schema → hấp thụ ở `EncoreRepo`, không lan vào agent.
- FE chỉ cần đảm bảo nhóm field 🔴; 🟡/⚪ là tuỳ, thiếu thì đổ default.

## 7. ⭐ Cái gì BỊ BỎ / THAY khi đấu nối vào system thật

Phần lớn file trong `ai-engine/dispatch/` hiện tại là **giàn giáo để test agent độc lập** (chạy không cần DB/FE). Khi nối vào hệ thật (service `board` + Postgres + FE web), những thứ sau **rời khỏi luồng chạy thật (prod path)** — nhưng **vẫn giữ trong repo** làm regression test.

> Phân biệt 2 nghĩa: **"BỎ khỏi prod"** = không nằm trong đường chạy thật, nhưng còn dùng để test. **"XOÁ hẳn"** = không còn lý do tồn tại.

### Theo file
| File | Số phận khi nối thật | Thay bằng / lý do |
|---|---|---|
| `contract.ts` | ✅ **GIỮ** | Source of truth, cả agent lẫn adapter dùng |
| `tools.ts` | ✅ **GIỮ** | MCP tools không đổi (vẫn gọi qua `DispatchRepository`) |
| `run.ts` | ✅ **GIỮ** (chỉnh nhẹ) | `onLog` callback đấu vào `stream.send()` thay vì `console.log`; host trong `streamOut` handler |
| `fake-repo.ts` | 🟠 **BỎ khỏi prod** (giữ để test) | → `encore-repo.ts`: đọc/ghi DB thật qua `~encore/clients` thay vì mảng in-memory |
| `seed.json` | 🟠 **BỎ khỏi prod** (giữ để test) | Dữ liệu giả → dữ liệu thật trong Postgres (`members`, `tasks`) |
| `expected.json` | 🟠 **BỎ khỏi prod** (giữ để test) | "Đáp án đúng" chỉ có nghĩa khi test; hệ thật không có ground-truth — con người review trên board |
| `check-expected.ts` | 🟠 **BỎ khỏi prod** (giữ để test) | Chỉ phục vụ so khớp tự động trong test |
| `test-local.ts` | 🟠 **BỎ khỏi prod** (giữ để test) | Runner standalone; giữ làm regression khi đổi prompt/model |
| `board-view.ts` | 🔴 **XOÁ hẳn** (hoặc giữ debug) | Bảng ASCII chỉ là FE tạm trong terminal; **FE web realtime thay thế hoàn toàn** |

### Theo cơ chế (code-level)
- 🟠 **Đọc seed bằng `readFileSync(seed.json)`** → thay bằng **query SQL** trong service `board`.
- 🟠 **Gán = mutate mảng in-memory** (`fake-repo.ts`) → thay bằng **`UPDATE ... WHERE id=$id AND status='todo'` (atomic)** + check `rowCount`. (Atomic mới là thật; FakeRepo chỉ mô phỏng.)
- 🔴 **In bảng ASCII + so khớp `expected.json` + `process.exit(0/1)`** → KHÔNG có trong prod. Thật: FE nhận `DispatchEvent` qua `streamOut`, card tự nhảy cột; "đúng/sai" do người duyệt.
- 🟢 **GIỮ NGUYÊN:** strip `ANTHROPIC_API_KEY` (vẫn dùng Pro quota), resolve `claude.exe`, `permissionMode:"bypassPermissions"`, prompt điều phối, bộ MCP tool.
- ⚙️ **npm scripts** `smoke:claude` / `test` / `test:dispatch` → là công cụ dev, không chạy trong runtime Encore (`encore run` không gọi tới chúng).

### Liên quan ngoài `dispatch/` (Phase 1)
- `ai-engine/scripts/smoke.ts` + endpoint `ping`/`ask` trong `ai-engine.ts`: chỉ để smoke-test Phase 1. Khi có `streamDispatch` thật → **giữ `ping` làm health-check**, có thể bỏ `ask`/`smoke.ts`.

### Quy tắc để không nhầm
> Mọi thứ dính tới **`seed` / `expected` / `fake` / `board-view`** = **giàn giáo test, KHÔNG lên prod**. Luồng thật chỉ gồm: `contract.ts` + `tools.ts` + `run.ts` + `encore-repo.ts` + `streamDispatch` handler.

---

## 8. Việc còn mở
- [ ] Lấy JSON mẫu `/members` + `/tasks` từ FE → điền §5.
- [ ] Xác nhận FE phân biệt được `assigneeId === "ai-agent"` để hiện nhãn 🤖.
- [ ] Chốt enum `status` hai bên có trùng tên không.
- [ ] Quyết định giữ `board-view.ts` làm debug tool hay xoá hẳn sau khi FE chạy.

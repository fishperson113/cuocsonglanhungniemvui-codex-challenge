# AI Engine — Checklist triển khai (Track B: spawn `claude` CLI, quota Pro)

> Theo `HACKATHON-MILESTONE.md` (Track B) + `AI-DISPATCHER-HACKATHON-PLAN.md`.
> Cập nhật: 2026-06-27.

## Trạng thái tổng quan

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **Phase 1** | Wrapper subprocess `claude` CLI + smoke test | ✅ **Done & verified** |
| **Phase 2** | Contract + `FakeRepo` + seed + Agent SDK + MCP tools + `runDispatch` (agent gán đúng) | ✅ **Done & verified** |
| **Phase 3** | Dispatch API cho FE: `POST /dispatch/start` (chạy nền) + `GET /dispatch/status/:jobId` (polling) | ✅ **Done & verified (encore run)** |
| **Phase 4** | Đấu nối board thật + FE: `EncoreRepo` (`~encore/clients`) + nút "Start" polling trên `/board` | ✅ **Done & verified (encore run)** |
| Phase 5 | `generate_document` (tectonic LaTeX) cho task AI claim (#5/#6) + đính artifact PDF | ⬜ Chưa |

---

## Phase 1 — Subprocess vào claude CLI ✅

### Môi trường (đã verify)
- [x] `claude.exe` v2.1.195 có trên PATH (`C:\Users\Acer\.local\bin\claude.exe`)
- [x] `ANTHROPIC_API_KEY` **rỗng** → dùng login Pro, không tốn tiền API
- [x] Node v24.15.0 (chạy `.ts` trực tiếp, không cần tsx), npx 11.3.0
- [x] Encore CLI v1.57.8

### Code đã viết
- [x] **Xóa code n8n** cũ trong `ai-engine` (forward webhook + circuit breaker)
- [x] `ai-engine/claude/cli.ts` — `runClaude(prompt, opts)`:
  - [x] Resolve `claude.exe`/`.cmd`/`.bat` qua PATH → spawn **không cần shell** (tránh warning DEP0190); override bằng `CLAUDE_CLI_PATH`
  - [x] Ghi prompt qua **stdin** (tránh lỗi quoting/space trên Windows)
  - [x] Parse `--output-format stream-json` (NDJSON theo dòng) → `events[]`
  - [x] Lấy `result`, `isError`, `durationMs`, `numTurns`, `costUsd`, `sessionId` từ event `result`
  - [x] Fallback ghép text từ message `assistant` khi thiếu event `result`
  - [x] Timeout (mặc định 120s) + kill subprocess
  - [x] Callback `onEvent` để stream tiến trình ra ngoài (chuẩn bị cho streamOut)
  - [x] **Strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`** trong env subprocess → ép Pro quota (option `useApiKey` để giữ lại nếu cần)
- [x] `ai-engine/scripts/smoke.ts` — test độc lập (không cần Encore)
- [x] `ai-engine/ai-engine.ts` — 2 endpoint Encore:
  - [x] `ping` (POST) — health check, gọi CLI trả "pong"
  - [x] `ask` (POST) — gọi CLI 1 lượt với `message` + `model?`
- [x] `package.json` — thêm script `smoke:claude`

### Test đã chạy
- [x] `npm run smoke:claude` → **PASS**
  ```
  model    : claude-opus-4-8
  result   : "ping"   isError: false   exitCode: 0
  ANTHROPIC_API_KEY: EMPTY → không bị đòi key (Pro quota ✓)
  ```
- [x] Verify lại sau khi bỏ `shell:true` → không còn warning DEP0190, vẫn PASS

### Cách chạy lại
```bash
cd budde
npm run smoke:claude                       # prompt mặc định "ping"
node ai-engine/scripts/smoke.ts "câu hỏi"  # prompt tuỳ ý
```

### Ghi chú quan trọng
- `costUsd` (~0.04) là **token-equivalent CLI tự tính**, KHÔNG phải tiền API thật (key rỗng + chạy được = đang dùng Pro). Đừng dựa vào cost để phán đoán Pro.
- Endpoint `ask`/`ping` chạy **đồng bộ** → chỉ hợp prompt ngắn. Agent dài (30s–vài phút) sẽ chuyển sang `api.streamOut` ở Phase 4.

---

## Phase 2 — Contract + FakeRepo + Agent loop ✅

> Gộp luôn agent loop (milestone Phase 3/B2) vì mục tiêu là "agent gán đúng từ seed".

### Code đã viết
- [x] `ai-engine/dispatch/contract.ts` — `Member`, `KanbanTask`, `TaskStatus`, `DispatchRepository`, `DispatchEvent` (single source of truth)
- [x] `ai-engine/dispatch/seed.json` — 5 member (Content/SEO/Ads/Designer/Sales) + 6 task todo (`assigneeId=null`), trong đó #5 report + #6 slide là in-scope của AI
- [x] `ai-engine/dispatch/fake-repo.ts` — `makeFakeRepo()` in-memory, `assignTask`/`claimTask` **atomic** (chỉ khi `status='todo'`, lần 2 → false) + `dump()` để soi state
- [x] `npm i @anthropic-ai/claude-agent-sdk@0.3.195 zod@4`
- [x] `ai-engine/dispatch/tools.ts` — `createDispatchServer(repo, log)`: `get_todo_tasks`, `get_members`, `assign_task`, `claim_task`
- [x] `ai-engine/dispatch/run.ts` — `runDispatch(repo, onLog)`: `query()` với MCP server, `permissionMode:"bypassPermissions"` + `allowDangerouslySkipPermissions:true`, **KHÔNG** set API key (Pro quota). Model mặc định `claude-sonnet-4-6` (override `DISPATCH_MODEL`)
- [x] `ai-engine/dispatch/board-view.ts` — `renderBoard()` vẽ bảng Kanban ASCII (4 cột todo/in_progress/review/done) để "nhìn thấy" card chạy trong terminal
- [x] `ai-engine/dispatch/expected.json` — **kỳ vọng phân công** (source of truth bài test); `assignee` = id member / `"ai-agent"` / mảng lựa chọn chấp nhận được; `expectNoTodoLeft`
- [x] `ai-engine/dispatch/check-expected.ts` — `checkExpected()` so khớp state thực tế ↔ expected, trả `✓/✗` từng task
- [x] `ai-engine/dispatch/test-local.ts` — chạy agent vs FakeRepo → in **bảng trước/sau** + **so khớp expected.json** (exit code 1 nếu lệch)
- [x] `package.json` — `npm test` và `npm run test:dispatch` đều chạy bài này (vitest cũ chuyển sang `npm run test:unit`)

### Test đã chạy
- [x] `npm test` → **PASS 7/7 khớp** (~46s, model sonnet-4-6)
  - #1→An (m1), #2→Dũng (m4), #3→Chi (m3), #4→Em (m5) — đúng chuyên môn
  - #5,#6 → 🤖 AI `claim` (in-scope report/slide)
  - Không còn task `todo`
  - Bảng Kanban ASCII: cột TODO → rỗng, IN PROGRESS → đầy đủ assignee

### Cách verify manual
```bash
cd budde
npm test                                # chạy agent thật → in bảng + so khớp expected.json
# đổi model:
#   PowerShell: $env:DISPATCH_MODEL='claude-opus-4-8'; npm test; Remove-Item Env:DISPATCH_MODEL
#   bash:       DISPATCH_MODEL=claude-opus-4-8 npm test
```
Đọc output theo thứ tự: **BẢNG TRƯỚC** (mọi task ở todo) → **`[agent] ...`** (suy luận + lý do) → **BẢNG SAU** (card nhảy sang in_progress) → **SO KHỚP** (`✓/✗` từng task vs expected.json) → `✓✓ PASS` / `✗ FAIL`.

**Bài test hồi quy:** sửa `seed.json` + `expected.json` cho khớp ý → `npm test`. Agent gán lệch expected → dòng `✗ #id: got=X expected=Y` + exit 1. Chỉnh prompt trong `run.ts` hoặc nới `assignee` thành mảng.

**Test atomic (chống gán đè):** mỗi lần chạy seed mới nên không tái hiện trực tiếp; atomic đã được FakeRepo enforce (`status!=='todo' → false`), agent log `✗ ... thất bại` nếu gặp task đã bị giữ.

## Phase 3 — Dispatch API cho FE (start + polling) ✅

> Pattern "1 nút bấm": FE bấm → `start` chạy agent **nền** → FE **poll** status để vẽ board "xoay xoay". Chọn polling thay streamOut vì đơn giản & ổn định hơn cho hackathon.

### Code đã viết
- [x] `ai-engine/dispatch/job-store.ts` — job store in-memory (`DispatchJob`: status/logs/tasks-snapshot/summary). Đủ cho localhost; Phase scale → Postgres/Pub-Sub, API giữ nguyên
- [x] `ai-engine/dispatch-api.ts` — 2 endpoint Encore:
  - `POST /dispatch/start` → tạo job, **fire-and-forget** `runDispatch` (không await), trả `{ jobId }` ngay
  - `GET /dispatch/status/:jobId` → `{ status, logs[], tasks[] (board snapshot), summary }`; 404 nếu job lạ
- [x] `fake-repo.ts` — seed path robust (chạy được cả `node` lẫn `encore run`, fallback theo cwd)
- [x] `onLog` callback vừa push `logs` vừa `repo.dump()` → board cập nhật mỗi bước

### Test đã chạy (qua `encore run`, port 4001)
- [x] `POST /dispatch/start` → trả `{status:"running", jobId}` **tức thì** (non-blocking)
- [x] Poll `GET /dispatch/status/:jobId` thấy board chuyển dần: `todo 6→2→0`, `in_progress 0→4→6`, `logs` tăng dần
- [x] `status` chuyển `running → done`; board cuối gán đúng (#1→m1, #2→m4, #3→m3, #4→m5, #5/#6→ai-agent)
- [x] `logs[]` chứa suy luận agent (cho panel FE); `summary` đầy đủ
- [x] Job lạ → HTTP 404

### Hợp đồng cho FE (polling pattern)
```
1. Bấm "Start"  → POST /dispatch/start            → nhận { jobId }
2. setInterval(~1s):
     GET /dispatch/status/{jobId}
       → vẽ board từ `tasks[]` (group theo status), append `logs[]`
       → nếu assigneeId === "ai-agent" gắn nhãn 🤖
3. Khi status !== "running" → clearInterval, hiện `summary` (status "done") / `error`
```

> ⚠️ Hiện dùng `FakeRepo` (seed) — mỗi lần start là 1 board mới reset. Phase 4 đổi `makeFakeRepo()` → `encoreRepo` (DB thật) trong `dispatch-api.ts`, mọi thứ khác giữ nguyên.

## Phase 4 — Đấu nối board thật + FE ✅

> Nối agent vào service `board` (Postgres) có sẵn + nút "Start" trên FE dùng **polling**.

### Code đã viết
- [x] `shared/contract.ts` là SSOT; `ai-engine/dispatch/contract.ts` **re-export** từ shared (hết drift)
- [x] `ai-engine/dispatch/encore-repo.ts` — `encoreRepo` implement `DispatchRepository` qua `~encore/clients` (`board.listTasks/listMembers/assignTask/claimTask/attachArtifact`). Board khớp 100% contract nên map 1-1
- [x] `ai-engine/dispatch/job-store.ts` — bỏ snapshot `tasks` (board state lấy thẳng từ `/tasks` DB), chỉ giữ logs/status/summary
- [x] `ai-engine/dispatch-api.ts` — dùng `encoreRepo` thay `FakeRepo`; fire-and-forget giữ context qua AsyncLocalStorage nên `~encore/clients` gọi được từ background
- [x] `frontend/app/board/page.tsx` — `startDispatch()` đổi từ **WebSocket** sang **polling**: `POST /dispatch/start` → mỗi 1.2s `GET /dispatch/status/:jobId` (logs) + `loadBoard()` (card nhảy cột) → dừng khi `status!=="running"`, hiện `summary`

### Test đã chạy (qua `encore run`, port 4001)
- [x] App build OK (`encoreRepo` + `~encore/clients` compile)
- [x] `POST /dispatch/start` → jobId tức thì; agent ghi **thẳng vào Postgres board**
- [x] Poll thấy DB đổi: `todo 6→1→0`, `in_progress 0→5→6`; `status running→done`
- [x] Assignment cuối trong DB đúng: #2→Designer, #3→Ads, #4→Sales, #5/#6→🤖 ai-agent (#1→SEO, nằm trong tập chấp nhận); `currentLoad` tự cập nhật (derived)
- [x] `GET /board` (Next dev) HTTP 200, render Kanban + nút Start, không lỗi compile

### Cách verify manual (UI thật)
```bash
cd budde
encore run            # mặc định :4000, hoặc encore run --port=4001
# mở http://127.0.0.1:4000/board  → bấm "Start" ở panel "AI Dispatch" bên phải
```
→ panel log chạy suy luận agent; card tự nhảy từ Todo sang In Progress kèm tên member / nhãn AI; xong hiện summary.
> Reset để demo lại: PATCH mỗi task về `{"status":"todo","assigneeId":null}` (hoặc thêm endpoint reset sau).

## Phase 5 — Self-serve LaTeX (generate_document) ⬜
- [ ] Cài + warm-cache `tectonic`; template `report.tex` / `slides.tex` (`%%TITLE%%`, `%%BODY%%`)
- [ ] Tool `generate_document` (ghép template → `tectonic --untrusted` → PDF → `repo.attachArtifact`) cho task #5/#6 AI đã claim
- [ ] Endpoint serve `/artifacts/*` để FE tải PDF; card hiện link artifact (FE đã có sẵn chỗ render `artifactUrl`)

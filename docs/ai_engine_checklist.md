# AI Engine — Checklist triển khai (Track B: spawn `claude` CLI, quota Pro)

> Theo `HACKATHON-MILESTONE.md` (Track B) + `AI-DISPATCHER-HACKATHON-PLAN.md`.
> Cập nhật: 2026-06-27.

## Trạng thái tổng quan

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **Phase 1** | Wrapper subprocess `claude` CLI + smoke test | ✅ **Done & verified** |
| **Phase 2** | Contract + `FakeRepo` + seed + Agent SDK + MCP tools + `runDispatch` (agent gán đúng) | ✅ **Done & verified** |
| Phase 4 | `generate_document` (tectonic LaTeX) + `streamOut` realtime + `EncoreRepo` | ⬜ Chưa |

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
- [x] `ai-engine/dispatch/test-local.ts` — chạy agent vs FakeRepo + **assertion tự động**
- [x] `package.json` — script `test:dispatch`

### Test đã chạy
- [x] `npm run test:dispatch` → **PASS** (~47s, model sonnet-4-6)
  - #5,#6 → 🤖 AI `claim`
  - #1→An (Content), #2→Dũng (Designer), #3→Chi (Ads), #4→Em (Sales)
  - Không còn task `todo`; 3/3 assertion xanh

### Cách verify manual
```bash
cd budde
npm run test:dispatch                                   # mặc định sonnet-4-6
DISPATCH_MODEL=claude-opus-4-8 npm run test:dispatch     # đổi model (PowerShell: $env:DISPATCH_MODEL='claude-opus-4-8'; npm run test:dispatch)
```
Đọc khối **KIỂM TRA** cuối output: cả 3 dòng `✓` + `✓✓ PASS` = đạt.
Soi `[agent] reason=...` để biết vì sao agent chọn member đó (chỉnh prompt trong `run.ts` nếu lệch).

**Test atomic (chống gán đè khi bấm Start 2 lần):** chạy `test:dispatch` 2 lần trên cùng tiến trình không tái hiện được (mỗi lần seed mới), nhưng atomic đã được FakeRepo enforce (`status!=='todo' → false`) và agent log `✗ ... thất bại` nếu gặp.

## Phase 4 — Self-serve LaTeX + Streaming + Encore ⬜
- [ ] Cài + warm-cache `tectonic`; template `report.tex` / `slides.tex` (`%%TITLE%%`, `%%BODY%%`)
- [ ] Tool `generate_document` (ghép template → `tectonic --untrusted` → PDF → `attachArtifact`)
- [ ] `EncoreRepo` (`~encore/clients` gọi service `board`)
- [ ] `api.streamOut` `/ai/dispatch/stream` host `runDispatch` → bắn `DispatchEvent` ra FE
- [ ] FE: nút "Start AI Dispatch" + panel log + move card realtime

# AI Engine — Checklist triển khai (Track B: spawn `claude` CLI, quota Pro)

> Theo `HACKATHON-MILESTONE.md` (Track B) + `AI-DISPATCHER-HACKATHON-PLAN.md`.
> Cập nhật: 2026-06-27.

## Trạng thái tổng quan

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **Phase 1** | Wrapper subprocess `claude` CLI + smoke test | ✅ **Done & verified** |
| Phase 2 | Contract `DispatchRepository` + `FakeRepo` + `seed.json` | ⬜ Chưa |
| Phase 3 | Agent SDK + MCP tools + `runDispatch` (tool-use loop) | ⬜ Chưa |
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

## Phase 2 — Contract + FakeRepo ⬜ (next)
- [ ] `shared/contract.ts`: `Member`, `KanbanTask`, `TaskStatus`, `DispatchRepository`, `DispatchEvent`
- [ ] `ai-engine/dispatch/seed.json`: 5 member + 6 task (4 dispatch + 2 in-scope report/slide)
- [ ] `ai-engine/dispatch/fake-repo.ts`: `makeFakeRepo()` in-memory, `assignTask`/`claimTask` atomic (gọi 2 lần lần 2 = false)
- [ ] Test: `assignTask` gọi 2 lần → lần 2 trả `false`

## Phase 3 — Agent loop (Agent SDK + MCP tools) ⬜
- [ ] `npm i @anthropic-ai/claude-agent-sdk zod`
- [ ] `dispatch/tools.ts`: `createDispatchServer(repo, log)` với tools `get_todo_tasks`, `get_members`, `assign_task`, `claim_task`
- [ ] `dispatch/run.ts`: `runDispatch(repo, onLog)` — `query()` với `permissionMode: "bypassPermissions"`, **KHÔNG** set `ANTHROPIC_API_KEY`
- [ ] `dispatch/test-local.ts`: chạy agent vs `FakeRepo`, kiểm matching đúng chuyên môn + phân loại in-scope

## Phase 4 — Self-serve LaTeX + Streaming + Encore ⬜
- [ ] Cài + warm-cache `tectonic`; template `report.tex` / `slides.tex` (`%%TITLE%%`, `%%BODY%%`)
- [ ] Tool `generate_document` (ghép template → `tectonic --untrusted` → PDF → `attachArtifact`)
- [ ] `EncoreRepo` (`~encore/clients` gọi service `board`)
- [ ] `api.streamOut` `/ai/dispatch/stream` host `runDispatch` → bắn `DispatchEvent` ra FE
- [ ] FE: nút "Start AI Dispatch" + panel log + move card realtime

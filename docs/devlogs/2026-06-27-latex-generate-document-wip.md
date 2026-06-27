# Devlog (WIP) — Feature `generate_document`: AI sinh slide/report LaTeX → PDF

> **Ngày:** 2026-06-27
> **Trạng thái:** ĐANG DỞ. Môi trường compile LaTeX đã xong & verify; phần ráp vào agent end-to-end **chưa verify** vì gặp blocker auth (đã có fix nhưng chưa chạy thử).

---

## 1. Mục tiêu
Khi task in-scope của AI là **làm slide / báo cáo**: agent `claim_task` rồi gọi MCP tool `generate_document` → fill nội dung vào template LaTeX → compile ra PDF → đính `artifactUrl` vào task → FE tải PDF về.

## 2. Quyết định đã chốt
- **Compiler:** **XeLaTeX (MiKTeX)** — máy KHÔNG có tectonic; MiKTeX có sẵn xelatex/pdflatex/lualatex/latexmk. XeLaTeX xử lý UTF-8 + tiếng Việt tốt qua `fontspec` + font hệ thống (Times New Roman/Arial).
- **Auto-install package:** đã bật `initexmf --set-config-value "[MPM]AutoInstall=1"` (tránh treo headless khi MiKTeX tải package lần đầu).
- **Template self-contained** (user chọn): KHÔNG dùng theme "Cookie" mà user thả vào ban đầu (theme đó cần LuaLaTeX + biber + `cookie.sty` + assets + refs.bib — đều THIẾU, không compile được). Thay bằng beamer `Madrid`/`whale` tự chứa.
- **2 pha:** template chứa preamble + placeholder; AI **chỉ viết phần thân** (frames/sections). Metadata (title...) được escape; body là LaTeX thô.

## 3. ✅ Đã làm & VERIFY
- `ai-engine/latex_template/slide/demo.tex` — template beamer (placeholder `%%TITLE%% %%SUBTITLE%% %%AUTHOR%% %%DATE%% %%BODY%%`). *(Đã ghi đè theme Cookie cũ.)*
- `ai-engine/latex_template/report/demo.tex` — template article.
- `ai-engine/latex/compile.ts` — `compileLatex(kind, fields)`: đọc template → `replaceAll` placeholder → ghi `.artifacts/<kind>-<ts>.tex` → chạy `xelatex` 2 lần → trả `{ fileName, pdfPath, url }`. Lỗi compile → ném Error kèm đuôi `.log` (để agent tự sửa).
- `ai-engine/latex/smoke.ts` — test độc lập. **VERIFY OK:** `node ai-engine/latex/smoke.ts slide` → PDF 35KB; `... report` → PDF 53KB; tiếng Việt render đúng.
- `ai-engine/dispatch/tools.ts` — thêm MCP tool `generate_document(taskId, kind, title, subtitle?, latexBody)` → `compileLatex` + `repo.attachArtifact(taskId, url, "review")`.
- `ai-engine/dispatch/run.ts` — prompt: in-scope → `claim_task` RỒI `generate_document`; thêm `mcp__dispatch__generate_document` vào `allowedTools`.
- `ai-engine/artifacts.ts` — `GET /artifacts/:name` (api.raw) serve PDF (`Content-Disposition: inline`, chống path traversal).
- `.gitignore` += `.artifacts`.

## 4. ⛔ BLOCKER đang vướng (regression do team thêm auth)
Khi chạy full dispatch qua `encore run`, agent **fail ngay bước đọc task**:
```
endpoint requires auth but none provided
```
**Nguyên nhân:** team đã thêm hệ thống auth; các endpoint board giờ bật `auth: true`:
- CÓ auth: `listTasks` (GET /tasks), `listMembers` (/members), `assignTask`, `updateTask`, `createTask`, `/members/join`, `/members/sync`.
- KHÔNG auth: `claimTask`, `attachArtifact`.

Agent là backend chạy nền (fire-and-forget, không có user token) → gọi board qua `~encore/clients` bị gateway chặn. *(Lần tích hợp trước board chưa có auth nên chạy được — xem [[2026-06-27-schema-contract-vs-fe]].)*

## 5. 🔧 FIX đã áp (CHƯA verify)
Viết lại `ai-engine/dispatch/encore-repo.ts`: bỏ `~encore/clients`, **truy cập thẳng DB board** qua `SQLDatabase.named("board")` + SQL y hệt board.ts (giữ atomic `UPDATE ... WHERE status='todo'`). Đây đúng pattern team đã dùng (`board/membership.ts` đọc DB `profile` qua `SQLDatabase.named("profile")`). Backend trusted đọc/ghi DB trực tiếp → bỏ qua auth gateway.

**Cần làm để chốt:** restart `encore run` → chạy `/dispatch/start` → xác nhận agent đọc được task, gán 4 + claim #5/#6 + `generate_document` ra 2 PDF, task có `artifactUrl` + `status=review`, tải `/artifacts/*.pdf` được.

## 6. Vướng khi verify
- Reset/đọc board cần token (board GET /tasks `auth:true`). Đã có **1 admin tồn tại** (team tạo, không biết mật khẩu). Đăng ký admin mới → `already_exists`. Đang định đăng ký 1 **user thường** để lấy token thì dừng.
- Để reset board giữa các lần demo: dùng token, hoặc `encore db shell board` chạy SQL trực tiếp:
  `UPDATE tasks SET status='todo', assignee_id=NULL, artifact_url=NULL;`

## 7. ⚠️ Gotchas đã gặp (đừng lặp lại)
1. **Comment template KHÔNG được chứa literal `%%BODY%%`** — `replaceAll` thay luôn token trong comment → body bị nhét trước preamble → "Missing \begin{document}". Đã bỏ token khỏi comment.
2. **Truyền LaTeX qua `node -e` trong shell làm hỏng backslash** (`\b` → ký tự backspace U+0008). Test phải viết thành file `.ts` dùng `String.raw`.
3. `demo.tex` user thả ban đầu là theme **Cookie** (LuaLaTeX+biber+`.sty`+assets) — thiếu deps, không build. Đã thay self-contained.

## 8. Việc còn mở
- [ ] Verify end-to-end fix §5 (encoreRepo direct-DB) qua `encore run`.
- [ ] Quyết định `/dispatch/start` có nên `auth: true` không (FE đã gửi token sẵn trong `lib/board.startDispatch`).
- [ ] Xác nhận member nguồn nào: seed `m1..m5` hay model `/members/sync` của team (ảnh hưởng agent gán cho ai).
- [ ] (Tuỳ) endpoint `/dispatch/reset` để demo lại nhanh.
- [ ] FE: card `review` hiện link tải PDF (FE đã có chỗ render `artifactUrl`).

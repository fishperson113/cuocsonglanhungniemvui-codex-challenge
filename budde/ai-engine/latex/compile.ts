/**
 * Compile LaTeX → PDF cho slide/report (XeLaTeX + MiKTeX, hỗ trợ tiếng Việt).
 *
 * Quy trình: đọc template `latex_template/<kind>/demo.tex` → thay placeholder
 * (%%TITLE%% / %%SUBTITLE%% / %%AUTHOR%% / %%DATE%% / %%BODY%%) → ghi .tex vào
 * thư mục artifacts → chạy xelatex (2 lần) → trả đường dẫn + URL PDF.
 *
 * AI chỉ cung cấp phần THÂN (body) là LaTeX hợp lệ; metadata (title...) được escape.
 * Lỗi compile → ném Error kèm đuôi log để agent tự sửa body và gọi lại.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const run = promisify(execFile);

export type DocKind = "slide" | "report";

export interface DocFields {
  title: string;
  subtitle?: string;
  author?: string;
  /** "\\today" hoặc text ngày (sẽ escape nếu là text thường). */
  date?: string;
  /** Thân tài liệu = LaTeX thô do AI viết (frames / sections). KHÔNG escape. */
  body: string;
}

export interface CompileResult {
  fileName: string; // "slide-<ts>.pdf"
  pdfPath: string; // tuyệt đối
  url: string; // "/artifacts/slide-<ts>.pdf"
}

/** Thư mục xuất PDF — theo cwd app (budde) để chạy được cả `node` lẫn `encore run`. */
export function artifactsDir(): string {
  return join(process.cwd(), ".artifacts");
}

function templatePath(kind: DocKind): string {
  return join(process.cwd(), "ai-engine", "latex_template", kind, "demo.tex");
}

/** Escape ký tự đặc biệt LaTeX cho metadata text ngắn (title/author...). */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function fillTemplate(tpl: string, f: DocFields): string {
  const date = f.date && f.date.trim() ? (f.date === "\\today" ? "\\today" : escapeLatex(f.date)) : "\\today";
  return tpl
    .replaceAll("%%TITLE%%", escapeLatex(f.title))
    .replaceAll("%%SUBTITLE%%", escapeLatex(f.subtitle ?? ""))
    .replaceAll("%%AUTHOR%%", escapeLatex(f.author ?? "AI Agent"))
    .replaceAll("%%DATE%%", date)
    .replaceAll("%%BODY%%", f.body);
}

export async function compileLatex(kind: DocKind, fields: DocFields): Promise<CompileResult> {
  const tplFile = templatePath(kind);
  if (!existsSync(tplFile)) throw new Error(`Không tìm thấy template: ${tplFile}`);
  const tpl = await readFile(tplFile, "utf8");
  const filled = fillTemplate(tpl, fields);

  const outDir = artifactsDir();
  await mkdir(outDir, { recursive: true });

  const base = `${kind}-${Date.now()}`;
  const texPath = join(outDir, `${base}.tex`);
  const pdfPath = join(outDir, `${base}.pdf`);
  const logPath = join(outDir, `${base}.log`);
  await writeFile(texPath, filled, "utf8");

  const args = [
    "-interaction=nonstopmode",
    "-halt-on-error",
    `-output-directory=${outDir}`,
    texPath,
  ];

  try {
    // Chạy 2 lần cho mục lục/tham chiếu (frame numbering, refs) ổn định.
    for (let i = 0; i < 2; i++) {
      await run("xelatex", args, { timeout: 120_000, cwd: outDir });
    }
  } catch (err) {
    // Lấy đuôi log để agent tự sửa.
    let tail = "";
    if (existsSync(logPath)) {
      const logText = await readFile(logPath, "utf8").catch(() => "");
      tail = logText.slice(-1500);
    } else {
      const e = err as { stdout?: string };
      tail = String(e.stdout ?? err).slice(-1500);
    }
    throw new Error(`xelatex compile lỗi:\n${tail}`);
  }

  if (!existsSync(pdfPath)) throw new Error("xelatex chạy xong nhưng không có PDF");
  return { fileName: `${base}.pdf`, pdfPath, url: `/artifacts/${base}.pdf` };
}

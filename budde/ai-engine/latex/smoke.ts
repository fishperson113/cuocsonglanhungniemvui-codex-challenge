/**
 * Smoke test compile LaTeX → PDF (chạy: node ai-engine/latex/smoke.ts [slide|report]).
 * Verify môi trường xelatex + template + tiếng Việt sinh ra PDF.
 */
import { compileLatex, type DocKind } from "./compile.ts";

const kind = (process.argv[2] as DocKind) || "slide";

const slideBody = String.raw`
\begin{frame}{Tổng quan tuần}
\begin{itemize}
  \item Doanh thu tăng 18\% so với tuần trước
  \item Chiến dịch Tết đạt 120\% mục tiêu
  \item 3 task in-scope được AI tự xử lý
\end{itemize}
\end{frame}

\begin{frame}{Kế hoạch tuần tới}
\begin{enumerate}
  \item Tối ưu chi phí quảng cáo Facebook
  \item Hoàn thiện bộ slide pitch khách hàng Y
\end{enumerate}
\end{frame}
`;

const reportBody = String.raw`
\section{Tổng quan}
Tuần qua hiệu quả marketing tăng trưởng tốt trên hầu hết các kênh.

\section{Số liệu chính}
\begin{itemize}
  \item Doanh thu tăng 18\% so với tuần trước.
  \item Chiến dịch Tết đạt 120\% mục tiêu đề ra.
\end{itemize}

\section{Đề xuất}
Tiếp tục tối ưu chi phí quảng cáo và mở rộng tệp khách hàng tiềm năng.
`;

const fields =
  kind === "report"
    ? { title: "Báo cáo Marketing tuần", subtitle: "Tổng kết & đề xuất", author: "AI Agent", body: reportBody }
    : { title: "Báo cáo Marketing tuần", subtitle: "Tổng kết & kế hoạch", author: "AI Agent", body: slideBody };

console.log(`→ Compile ${kind}...`);
try {
  const res = await compileLatex(kind, fields);
  console.log("✓ PASS — PDF:", res.fileName);
  console.log("  url :", res.url);
  console.log("  path:", res.pdfPath);
  process.exit(0);
} catch (err) {
  console.error("✗ FAIL —", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

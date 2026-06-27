/**
 * Serve PDF artifact do agent sinh ra: GET /artifacts/:name
 * FE mở link (card hiện "Xem artifact") → preview/download PDF.
 */
import { api } from "encore.dev/api";
import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { artifactsDir } from "./latex/compile";

export const downloadArtifact = api.raw(
  { expose: true, method: "GET", path: "/artifacts/:name" },
  async (req, resp) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const name = basename(decodeURIComponent(url.pathname));

    // Chỉ cho phép tên file PDF an toàn (chống path traversal).
    if (!/^[A-Za-z0-9._-]+\.pdf$/.test(name)) {
      resp.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      resp.end("tên file không hợp lệ");
      return;
    }

    const file = join(artifactsDir(), name);
    if (!existsSync(file)) {
      resp.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      resp.end("không tìm thấy artifact");
      return;
    }

    resp.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": statSync(file).size,
      "Content-Disposition": `inline; filename="${name}"`,
    });
    createReadStream(file).pipe(resp);
  },
);

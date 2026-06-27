/**
 * API điều phối cho FE: 1 nút bấm → start (chạy nền) + polling status.
 *
 *   POST /dispatch/start            → tạo job, chạy agent nền, trả { jobId } NGAY
 *   GET  /dispatch/status/:jobId    → trạng thái job (logs + summary)
 *
 * Board state (card nhảy cột) → FE poll thẳng `/tasks` của service board (DB thật).
 * FE: bấm nút → start → ~1s gọi status (logs) + reload /tasks (board), dừng khi status != "running".
 */
import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { randomUUID } from "node:crypto";
import { runDispatch } from "./dispatch/run";
import { encoreRepo } from "./dispatch/encore-repo";
import { createJob, getJob, pruneOldJobs, type DispatchJob } from "./dispatch/job-store";

export interface StartResponse {
  jobId: string;
  status: DispatchJob["status"];
}

/**
 * Bấm nút "Start AI Dispatch". Khởi tạo job + chạy agent NỀN (không await),
 * trả jobId tức thì để FE bắt đầu poll. Agent ghi assignment vào DB board thật.
 */
export const startDispatch = api<void, StartResponse>(
  { method: "POST", expose: true, path: "/dispatch/start" },
  async () => {
    pruneOldJobs();

    const jobId = randomUUID();
    const job = createJob(jobId);
    log.info("dispatch: start job", { jobId });

    // Fire-and-forget: agent chạy nền và mutate job qua callback.
    // MCP tools dùng encoreRepo direct-DB nên không gọi /tasks qua auth gateway.
    void (async () => {
      try {
        const summary = await runDispatch(encoreRepo, (line) => {
          job.logs.push(line);
        });
        job.summary = summary;
        job.status = "done";
        log.info("dispatch: job done", { jobId });
      } catch (e) {
        job.status = "error";
        job.error = String(e);
        log.error("dispatch: job error", { jobId, error: String(e) });
      } finally {
        job.finishedAt = Date.now();
      }
    })();

    return { jobId, status: job.status };
  },
);

export interface StatusParams {
  jobId: string;
}

/** Polling trạng thái 1 job. FE gọi định kỳ tới khi status != "running". */
export const dispatchStatus = api<StatusParams, DispatchJob>(
  { method: "GET", expose: true, path: "/dispatch/status/:jobId" },
  async ({ jobId }) => {
    const job = getJob(jobId);
    if (!job) throw APIError.notFound(`job ${jobId} không tồn tại (có thể đã hết hạn)`);
    return job;
  },
);

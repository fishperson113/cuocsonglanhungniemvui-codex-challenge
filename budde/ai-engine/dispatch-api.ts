/**
 * API điều phối cho FE: 1 nút bấm → start (chạy nền) + polling status.
 *
 *   POST /dispatch/start            → tạo job, chạy agent nền, trả { jobId } NGAY
 *   GET  /dispatch/status/:jobId    → trạng thái job (logs + board snapshot + summary)
 *
 * FE: bấm nút → start → cứ ~1s gọi status, vẽ lại board theo `tasks`, append `logs`,
 * dừng poll khi status != "running".
 */
import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { randomUUID } from "node:crypto";
import { makeFakeRepo } from "./dispatch/fake-repo";
import { runDispatch } from "./dispatch/run";
import { createJob, getJob, pruneOldJobs, type DispatchJob } from "./dispatch/job-store";

export interface StartResponse {
  jobId: string;
  status: DispatchJob["status"];
}

/**
 * Bấm nút "Start AI Dispatch". Khởi tạo job + chạy agent NỀN (không await),
 * trả jobId tức thì để FE bắt đầu poll.
 */
export const startDispatch = api<void, StartResponse>(
  { method: "POST", expose: true, path: "/dispatch/start" },
  async () => {
    pruneOldJobs();

    const jobId = randomUUID();
    const repo = makeFakeRepo(); // TODO Phase 4: thay bằng encoreRepo (DB thật)
    const job = createJob(jobId, repo.dump());
    log.info("dispatch: start job", { jobId });

    // ── Fire-and-forget: agent chạy nền, mutate job qua callback ──────
    void (async () => {
      try {
        const summary = await runDispatch(repo, (line) => {
          job.logs.push(line);
          job.tasks = repo.dump(); // cập nhật board mỗi bước → FE thấy card nhảy
        });
        job.tasks = repo.dump();
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

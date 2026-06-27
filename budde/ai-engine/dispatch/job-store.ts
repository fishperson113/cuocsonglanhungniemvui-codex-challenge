/**
 * Job store in-memory cho dispatch chạy nền + polling.
 * Đủ cho localhost `encore run` (single process). Khi scale/deploy thật → thay bằng
 * Postgres hoặc Pub/Sub + bảng job; API polling giữ nguyên.
 *
 * Board state KHÔNG lưu ở đây — FE poll thẳng `/tasks` (DB là source of truth).
 * Job chỉ giữ log suy luận agent + trạng thái + summary.
 */
export type JobStatus = "running" | "done" | "error";

export interface DispatchJob {
  id: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  /** Log suy luận agent (FE render panel bên phải). */
  logs: string[];
  /** Tóm tắt cuối khi xong. */
  summary?: string;
  error?: string;
}

const jobs = new Map<string, DispatchJob>();

export function createJob(id: string): DispatchJob {
  const job: DispatchJob = {
    id,
    status: "running",
    startedAt: Date.now(),
    logs: [],
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): DispatchJob | undefined {
  return jobs.get(id);
}

/** Dọn job cũ (>30') để tránh phình bộ nhớ — gọi tuỳ ý. */
export function pruneOldJobs(maxAgeMs = 30 * 60_000): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > maxAgeMs) jobs.delete(id);
  }
}

/**
 * Job store in-memory cho dispatch chạy nền + polling.
 * Đủ cho localhost `encore run` (single process). Khi scale/deploy thật → thay bằng
 * Postgres hoặc Pub/Sub + bảng job; API polling giữ nguyên.
 */
import type { KanbanTask } from "./contract.ts";

export type JobStatus = "running" | "done" | "error";

export interface DispatchJob {
  id: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  /** Log suy luận agent (FE render panel bên phải). */
  logs: string[];
  /** Snapshot board hiện tại — cập nhật mỗi bước để FE vẽ card nhảy cột. */
  tasks: KanbanTask[];
  /** Tóm tắt cuối khi xong. */
  summary?: string;
  error?: string;
}

const jobs = new Map<string, DispatchJob>();

export function createJob(id: string, tasks: KanbanTask[]): DispatchJob {
  const job: DispatchJob = {
    id,
    status: "running",
    startedAt: Date.now(),
    logs: [],
    tasks,
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

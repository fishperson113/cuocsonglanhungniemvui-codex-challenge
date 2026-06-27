/**
 * SINGLE SOURCE OF TRUTH — contract giữa orchestration (ai-engine) và Kanban backend.
 * Khi build service `board`, nó implement đúng interface này; agent code theo nó.
 * (Tương ứng `shared/contract.ts` trong HACKATHON-MILESTONE.md §2.)
 */
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface Member {
  id: string;
  name: string;
  /** Khóa matching chính, vd "Content Writer", "SEO", "Performance Ads". */
  title: string;
  skills: string[];
  currentLoad: number;
}

export interface KanbanTask {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  /** member.id | "ai-agent" | null */
  assigneeId: string | null;
  labels: string[];
  priority: number;
  artifactUrl: string | null;
}

/** Cổng dữ liệu — agent gọi qua đây. FakeRepo (test) và EncoreRepo (thật) cùng implement. */
export interface DispatchRepository {
  getTodoTasks(): Promise<KanbanTask[]>;
  getMembers(): Promise<Member[]>;
  /** ATOMIC: chỉ gán khi task còn 'todo'. Trả false nếu đã bị gán. */
  assignTask(taskId: number, assigneeId: string): Promise<boolean>;
  /** AI tự nhận task (assignee="ai-agent", status=in_progress). Atomic, trả false nếu đã bị giữ. */
  claimTask(taskId: number): Promise<boolean>;
  /** Đính PDF + đẩy status (mặc định 'review'). */
  attachArtifact(taskId: number, url: string, status?: TaskStatus): Promise<void>;
}

/** Sự kiện đẩy ra FE qua streamOut (dùng ở Phase 4). */
export type DispatchEvent =
  | { type: "log"; text: string }
  | { type: "task_update"; taskId: number; status: TaskStatus; assigneeId: string | null }
  | { type: "artifact"; taskId: number; url: string }
  | { type: "done"; summary: string };

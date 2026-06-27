export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface Member {
  id: string;
  name: string;
  title: string;
  skills: string[];
  currentLoad: number;
}

export interface KanbanTask {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  labels: string[];
  priority: number;
  artifactUrl: string | null;
}

export interface DispatchRepository {
  getTodoTasks(): Promise<KanbanTask[]>;
  getMembers(): Promise<Member[]>;
  assignTask(taskId: number, assigneeId: string): Promise<boolean>;
  claimTask(taskId: number): Promise<boolean>;
  attachArtifact(taskId: number, url: string, status?: TaskStatus): Promise<void>;
}

export type DispatchEvent =
  | { type: "log"; text: string }
  | { type: "task_update"; taskId: number; status: TaskStatus; assigneeId: string | null }
  | { type: "artifact"; taskId: number; url: string }
  | { type: "done"; summary: string };

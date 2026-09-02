export type DiffSide = "LEFT" | "RIGHT";

export type ReviewState =
  | "running"
  | "publishing"
  | "completed"
  | "failed"
  | "superseded";

export type ReviewPriority = "P0" | "P1" | "P2" | "P3";

export interface ReviewRun {
  createdAt: string;
  headSha: string;
  prNumber: number;
  repoFullName: string;
  runId: string;
  state: ReviewState;
  statusCommentId?: string;
  threadId: string;
}

export interface DiffAnchor {
  hunk: number;
  id: string;
  line: number;
  offset: number;
  path: string;
  side: DiffSide;
}

export interface ReviewFinding {
  anchorId: string;
  category: string;
  explanation: string;
  impact: string;
  priority: ReviewPriority;
  recommendation: string;
  startAnchorId?: string;
  suggestion?: string;
  title: string;
}

export interface ReviewReport {
  findings: ReviewFinding[];
  summary: string;
  verdict: "clean" | "findings";
}

export interface ReviewScope {
  changedFiles: number;
  headSha: string;
}

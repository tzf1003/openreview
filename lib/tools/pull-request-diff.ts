import { tool } from "ai";
import { z } from "zod";

import { getDiffChunk, loadDiffSnapshot } from "@/lib/review/anchors";
import type { DiffSnapshot } from "@/lib/review/anchors";

interface PullRequestDiffToolOptions {
  baseRevision: string;
  prRevision: string;
  repoFullName: string;
}

export const createPullRequestDiffTool = (
  options: PullRequestDiffToolOptions
) => {
  let completed = false;
  let snapshot: Promise<DiffSnapshot> | null = null;

  const getSnapshot = (): Promise<DiffSnapshot> => {
    snapshot ??= loadDiffSnapshot(options);
    return snapshot;
  };

  return {
    getSnapshot,
    hasReadCompleteDiff: () => completed,
    tool: tool({
      description:
        "读取一个按顺序排列的 PR diff 分片及其可信行 Anchor。必须从 offset 0 开始，持续传入 nextOffset，直至其为 null。",
      execute: async ({ offset }) => {
        const chunk = getDiffChunk(await getSnapshot(), offset);
        completed ||= chunk.nextOffset === null;
        return chunk;
      },
      inputSchema: z.object({
        offset: z.number().int().nonnegative().default(0),
      }),
    }),
  };
};

import { FatalError } from "workflow";

import { parseError } from "@/lib/error";
import { failReviewStatus } from "@/lib/review/status";
import type { ReviewRun } from "@/lib/review/types";

import { addPRComment } from "./steps/add-pr-comment";
import { createSandbox } from "./steps/create-sandbox";
import { extendSandbox } from "./steps/extend-sandbox";
import { installDependencies } from "./steps/install-dependencies";
import { runAgent } from "./steps/run-agent";
import { stopSandbox } from "./steps/stop-sandbox";

export interface ThreadMessage {
  content: string;
  role: "assistant" | "user";
}

export interface WorkflowParams {
  baseRevision: string;
  installProjectDependencies?: boolean;
  messages: ThreadMessage[];
  prRevision: string;
  prNumber: number;
  repoFullName: string;
  reviewRun?: ReviewRun;
  threadId: string;
}

interface SandboxReviewOptions {
  baseRevision: string;
  installProjectDependencies: boolean;
  messages: ThreadMessage[];
  prRevision: string;
  prNumber: number;
  repoFullName: string;
  reviewRun?: ReviewRun;
  sandboxId: string;
  threadId: string;
}

const runSandboxReview = async (
  options: SandboxReviewOptions
): Promise<void> => {
  await installDependencies(options.sandboxId, {
    installProjectDependencies: options.installProjectDependencies,
  });
  await extendSandbox(options.sandboxId);

  const result = await runAgent({
    baseRevision: options.baseRevision,
    messages: options.messages,
    prNumber: options.prNumber,
    prRevision: options.prRevision,
    repoFullName: options.repoFullName,
    reviewRun: options.reviewRun,
    sandboxId: options.sandboxId,
    threadId: options.threadId,
  });
  if (!result.success) {
    throw new FatalError(result.errorMessage ?? "Agent failed to run");
  }
};

const reportInteractiveWorkflowError = async (
  threadId: string,
  error: unknown
): Promise<void> => {
  await addPRComment(
    threadId,
    `## Xsec Review · 处理失败

处理你的请求时发生错误：

\`\`\`
${parseError(error)}
\`\`\`

---
*由 Xsec Review 提供*`
  );
};

export const botWorkflow = async (params: WorkflowParams): Promise<void> => {
  "use workflow";

  const {
    baseRevision,
    installProjectDependencies = true,
    messages,
    prRevision,
    prNumber,
    repoFullName,
    reviewRun,
    threadId,
  } = params;

  const sandboxId = await createSandbox(repoFullName, prRevision);

  try {
    await runSandboxReview({
      baseRevision,
      installProjectDependencies,
      messages,
      prNumber,
      prRevision,
      repoFullName,
      reviewRun,
      sandboxId,
      threadId,
    });
  } catch (error) {
    await (reviewRun
      ? failReviewStatus(reviewRun, error)
      : reportInteractiveWorkflowError(threadId, error));
    throw error;
  } finally {
    await stopSandbox(sandboxId);
  }
};

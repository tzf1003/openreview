import { FatalError } from "workflow";

import { parseError } from "@/lib/error";

import { addPRComment } from "./steps/add-pr-comment";
import { checkPushAccess } from "./steps/check-push-access";
import { commitAndPush } from "./steps/commit-and-push";
import { configureGit } from "./steps/configure-git";
import { createSandbox } from "./steps/create-sandbox";
import { extendSandbox } from "./steps/extend-sandbox";
import { getGitHubToken } from "./steps/get-github-token";
import { hasUncommittedChanges } from "./steps/has-uncommitted-changes";
import { installDependencies } from "./steps/install-dependencies";
import { runAgent } from "./steps/run-agent";
import { stopSandbox } from "./steps/stop-sandbox";

export interface ThreadMessage {
  content: string;
  role: "assistant" | "user";
}

export interface WorkflowParams {
  allowPushChanges?: boolean;
  baseBranch: string;
  installProjectDependencies?: boolean;
  messages: ThreadMessage[];
  prBranch: string;
  prNumber: number;
  repoFullName: string;
  sourceRepoFullName?: string;
  threadId: string;
}

interface SandboxReviewOptions {
  allowPushChanges: boolean;
  installProjectDependencies: boolean;
  messages: ThreadMessage[];
  prBranch: string;
  prNumber: number;
  repoFullName: string;
  sandboxId: string;
  threadId: string;
  token: string;
}

const ensurePushAccess = async (
  repoFullName: string,
  prBranch: string,
  threadId: string
): Promise<void> => {
  const pushAccess = await checkPushAccess(repoFullName, prBranch);
  if (pushAccess.canPush) {
    return;
  }

  await addPRComment(
    threadId,
    `## Skipped

Unable to access this branch: ${pushAccess.reason}

Please ensure the OpenReview app has access to this repository and branch.

---
*Powered by [OpenReview](https://github.com/vercel-labs/openreview)*`
  );
  throw new FatalError(pushAccess.reason ?? "Push access denied");
};

const runSandboxReview = async (
  options: SandboxReviewOptions
): Promise<void> => {
  await installDependencies(options.sandboxId, {
    installProjectDependencies: options.installProjectDependencies,
  });
  await configureGit(options.sandboxId, options.repoFullName, options.token);
  await extendSandbox(options.sandboxId);

  const result = await runAgent(
    options.sandboxId,
    options.messages,
    options.threadId,
    options.prNumber,
    options.repoFullName
  );
  if (!result.success) {
    throw new FatalError(result.errorMessage ?? "Agent failed to run");
  }
  if (
    options.allowPushChanges &&
    (await hasUncommittedChanges(options.sandboxId))
  ) {
    await commitAndPush(
      options.sandboxId,
      "openreview: apply changes",
      options.prBranch
    );
  }
};

const reportWorkflowError = async (
  threadId: string,
  error: unknown
): Promise<void> => {
  await addPRComment(
    threadId,
    `## Error

An error occurred while processing your request:

\`\`\`
${parseError(error)}
\`\`\`

---
*Powered by [OpenReview](https://github.com/vercel-labs/openreview)*`
  );
};

export const botWorkflow = async (params: WorkflowParams): Promise<void> => {
  "use workflow";

  const {
    allowPushChanges = true,
    baseBranch: _baseBranch,
    installProjectDependencies = true,
    messages,
    prBranch,
    prNumber,
    repoFullName,
    sourceRepoFullName = repoFullName,
    threadId,
  } = params;

  if (allowPushChanges) {
    await ensurePushAccess(repoFullName, prBranch, threadId);
  }

  const token = await getGitHubToken();
  const sandboxId = await createSandbox(sourceRepoFullName, token, prBranch);

  try {
    await runSandboxReview({
      allowPushChanges,
      installProjectDependencies,
      messages,
      prBranch,
      prNumber,
      repoFullName,
      sandboxId,
      threadId,
      token,
    });
  } catch (error) {
    await reportWorkflowError(threadId, error);
    throw error;
  } finally {
    await stopSandbox(sandboxId);
  }
};

import "server-only";
import { ThreadImpl } from "chat";
import { start } from "workflow/api";
import { z } from "zod";

import { getBot } from "@/lib/bot";
import { env } from "@/lib/env";
import { getGitHubApp } from "@/lib/github";
import { botWorkflow } from "@/workflow";
import type { WorkflowParams } from "@/workflow";

const AUTO_REVIEW_ACTIONS = new Set([
  "opened",
  "ready_for_review",
  "reopened",
  "synchronize",
]);

const pullRequestWebhookSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  pull_request: z.object({
    base: z.object({ ref: z.string().min(1) }),
    draft: z.boolean().nullable(),
    head: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string().min(3) }),
      sha: z.string().min(1),
    }),
    number: z.number().int().positive(),
  }),
  repository: z.object({ full_name: z.string().min(3) }),
});

type PullRequestWebhook = z.infer<typeof pullRequestWebhookSchema>;

const parsePayload = (body: string): PullRequestWebhook | null => {
  try {
    return pullRequestWebhookSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
};

const shouldReview = (payload: PullRequestWebhook): boolean =>
  AUTO_REVIEW_ACTIONS.has(payload.action) && !payload.pull_request.draft;

const createReviewPrompt = (headSha: string): string =>
  `Review the pull request at commit ${headSha}. Inspect the complete diff and ` +
  "report actionable correctness, security, reliability, and maintainability " +
  "issues. Do not modify files, commit, or push. Post a concise review; if " +
  "there are no actionable findings, state that clearly.";

const startAutomaticReview = async (
  payload: PullRequestWebhook
): Promise<void> => {
  const bot = await getBot();
  await bot.initialize();

  const adapter = bot.getAdapter("github");
  const { full_name: repoFullName } = payload.repository;
  const [owner, repo] = repoFullName.split("/");
  const { pull_request: pullRequest } = payload;
  const threadId = adapter.encodeThreadId({
    owner,
    prNumber: pullRequest.number,
    repo,
  });
  if (!adapter.channelIdFromThreadId) {
    throw new Error("GitHub adapter cannot derive a channel ID");
  }
  const thread = new ThreadImpl({
    adapter,
    channelId: adapter.channelIdFromThreadId(threadId),
    id: threadId,
    stateAdapter: bot.getState(),
  });

  await thread.setState({
    baseBranch: pullRequest.base.ref,
    prBranch: pullRequest.head.ref,
    prNumber: pullRequest.number,
    repoFullName,
  });
  await thread.subscribe();
  await start(botWorkflow, [
    {
      allowPushChanges: false,
      baseBranch: pullRequest.base.ref,
      installProjectDependencies: false,
      messages: [
        { content: createReviewPrompt(pullRequest.head.sha), role: "user" },
      ],
      prBranch: pullRequest.head.ref,
      prNumber: pullRequest.number,
      repoFullName,
      sourceRepoFullName: pullRequest.head.repo.full_name,
      threadId,
    } satisfies WorkflowParams,
  ]);
};

const isExpectedInstallation = (payload: PullRequestWebhook): boolean =>
  payload.installation.id === env.GITHUB_APP_INSTALLATION_ID;

export const handlePullRequestWebhook = async (
  request: Request
): Promise<Response> => {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!signature || !(await getGitHubApp().webhooks.verify(body, signature))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = parsePayload(body);
  if (!payload) {
    return new Response("Invalid pull request payload", { status: 400 });
  }
  if (!isExpectedInstallation(payload)) {
    return new Response("Unexpected installation", { status: 403 });
  }
  if (!shouldReview(payload)) {
    return new Response("ignored", { status: 200 });
  }

  await startAutomaticReview(payload);
  return new Response("accepted", { status: 202 });
};

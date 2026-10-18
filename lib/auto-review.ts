import "server-only";
import { ThreadImpl } from "chat";
import { start } from "workflow/api";
import { z } from "zod";

import { getBot } from "@/lib/bot";
import { env } from "@/lib/env";
import { getGitHubApp } from "@/lib/github";
import { getPullRequestRevision } from "@/lib/review/pull-request";
import { claimReviewRun } from "@/lib/review/state";
import { startReviewStatus, supersedeReviewStatus } from "@/lib/review/status";
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
    base: z.object({ sha: z.string().min(1) }),
    draft: z.boolean().nullable(),
    head: z.object({ sha: z.string().min(1) }),
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
  `请审计提交 ${headSha} 对应的拉取请求。完整读取 diff 后，报告可操作的` +
  "正确性、安全性、可靠性和可维护性问题。不得修改文件、提交或推送。";

const startAutomaticReview = async (
  payload: PullRequestWebhook,
  deliveryId: string
): Promise<boolean> => {
  const bot = await getBot();
  await bot.initialize();

  const adapter = bot.getAdapter("github");
  const { full_name: repoFullName } = payload.repository;
  const [owner, repo] = repoFullName.split("/");
  const { pull_request: pullRequest } = payload;
  const revisions = await getPullRequestRevision(
    repoFullName,
    pullRequest.number
  );
  if (revisions.prRevision !== pullRequest.head.sha) {
    return false;
  }
  const threadId = adapter.encodeThreadId({
    owner,
    prNumber: pullRequest.number,
    repo,
  });
  if (!adapter.channelIdFromThreadId) {
    throw new Error("GitHub adapter cannot derive a channel ID");
  }
  const claim = await claimReviewRun({
    deliveryId,
    headSha: revisions.prRevision,
    prNumber: pullRequest.number,
    repoFullName,
    threadId,
  });
  if (!claim) {
    return false;
  }
  const { run } = claim;
  const thread = new ThreadImpl({
    adapter,
    channelId: adapter.channelIdFromThreadId(threadId),
    id: threadId,
    stateAdapter: bot.getState(),
  });

  await thread.setState({
    prNumber: pullRequest.number,
    repoFullName,
  });
  await thread.subscribe();
  if (claim.replacedRun && claim.replacedRun.headSha !== run.headSha) {
    await supersedeReviewStatus(claim.replacedRun, run.headSha);
  }
  const reviewRun = await startReviewStatus(run);
  await start(botWorkflow, [
    {
      baseRevision: revisions.baseRevision,
      installProjectDependencies: false,
      messages: [
        { content: createReviewPrompt(revisions.prRevision), role: "user" },
      ],
      prNumber: pullRequest.number,
      prRevision: revisions.prRevision,
      repoFullName,
      reviewRun,
      threadId,
    } satisfies WorkflowParams,
  ]);
  return true;
};

const isExpectedInstallation = (payload: PullRequestWebhook): boolean =>
  payload.installation.id === env.GITHUB_APP_INSTALLATION_ID;

export const handlePullRequestWebhook = async (
  request: Request
): Promise<Response> => {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const deliveryId = request.headers.get("x-github-delivery");

  if (!signature || !(await getGitHubApp().webhooks.verify(body, signature))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = parsePayload(body);
  if (!payload) {
    return new Response("Invalid pull request payload", { status: 400 });
  }
  if (!deliveryId) {
    return new Response("Missing GitHub delivery ID", { status: 400 });
  }
  if (!isExpectedInstallation(payload)) {
    return new Response("Unexpected installation", { status: 403 });
  }
  if (!shouldReview(payload)) {
    return new Response("ignored", { status: 200 });
  }

  const accepted = await startAutomaticReview(payload, deliveryId);
  return new Response(accepted ? "accepted" : "ignored", {
    status: accepted ? 202 : 200,
  });
};

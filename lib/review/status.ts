import "server-only";
import { emoji } from "chat";

import { getBot } from "@/lib/bot";

import {
  publicReviewFailureReason,
  renderReviewCompleted,
  renderReviewFailure,
  renderReviewStarted,
  renderReviewSuperseded,
} from "./render";
import { getReviewRun, setReviewRunState, updateReviewRun } from "./state";
import type { ReviewRun } from "./types";

const requireStatusCommentId = (run: ReviewRun): string => {
  if (!run.statusCommentId) {
    throw new Error("Review status comment is missing");
  }
  return run.statusCommentId;
};

const getGitHubAdapter = async () => {
  const bot = await getBot();
  return bot.getAdapter("github");
};

export const startReviewStatus = async (run: ReviewRun): Promise<ReviewRun> => {
  "use step";

  const adapter = await getGitHubAdapter();
  const message = await adapter.postMessage(run.threadId, {
    markdown: renderReviewStarted(run),
  });
  const updated = await updateReviewRun(run, { statusCommentId: message.id });
  await adapter.addReaction(updated.threadId, message.id, emoji.eyes);
  return updated;
};

export const removeInProgressReaction = async (
  run: ReviewRun
): Promise<void> => {
  "use step";

  const adapter = await getGitHubAdapter();
  await adapter.removeReaction(
    run.threadId,
    requireStatusCommentId(run),
    emoji.eyes
  );
};

export const addCleanReaction = async (run: ReviewRun): Promise<void> => {
  "use step";

  const adapter = await getGitHubAdapter();
  await adapter.addReaction(
    run.threadId,
    requireStatusCommentId(run),
    emoji.thumbs_up
  );
};

export const completeReviewStatus = async (run: ReviewRun): Promise<void> => {
  "use step";

  const adapter = await getGitHubAdapter();
  await adapter.editMessage(run.threadId, requireStatusCommentId(run), {
    markdown: renderReviewCompleted(run),
  });
};

export const supersedeReviewStatus = async (
  run: ReviewRun,
  currentHeadSha: string
): Promise<void> => {
  "use step";

  if (!run.statusCommentId) {
    await setReviewRunState(run, "superseded");
    return;
  }
  await removeInProgressReaction(run);
  const adapter = await getGitHubAdapter();
  await adapter.editMessage(run.threadId, requireStatusCommentId(run), {
    markdown: renderReviewSuperseded(run, currentHeadSha),
  });
  await setReviewRunState(run, "superseded");
};

export const failReviewStatus = async (
  initialRun: ReviewRun,
  error: unknown
): Promise<void> => {
  "use step";

  const run =
    (await getReviewRun(
      initialRun.repoFullName,
      initialRun.prNumber,
      initialRun.headSha
    )) ?? initialRun;
  if (
    run.state === "completed" ||
    run.state === "superseded" ||
    !run.statusCommentId
  ) {
    return;
  }
  await removeInProgressReaction(run);
  const adapter = await getGitHubAdapter();
  await adapter.editMessage(run.threadId, run.statusCommentId, {
    markdown: renderReviewFailure(run, publicReviewFailureReason(error)),
  });
  await setReviewRunState(run, "failed");
};

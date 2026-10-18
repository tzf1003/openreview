import "server-only";
import { getInstallationOctokit } from "@/lib/github";

import { getChangedFileCount } from "./anchors";
import { getPullRequestRevision, parseRepositoryName } from "./pull-request";
import {
  getReviewMarker,
  renderInlineFinding,
  renderReviewBody,
} from "./render";
import { isActiveReviewRun, setReviewRunState } from "./state";
import {
  addCleanReaction,
  completeReviewStatus,
  removeInProgressReaction,
  supersedeReviewStatus,
} from "./status";
import type {
  DiffAnchor,
  ReviewFinding,
  ReviewReport,
  ReviewRun,
} from "./types";

interface PublishReviewInput {
  anchors: DiffAnchor[];
  diff: string;
  report: ReviewReport;
  run: ReviewRun;
}

interface GitHubReviewComment {
  body: string;
  line: number;
  path: string;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
}

const getAnchor = (
  anchors: Map<string, DiffAnchor>,
  anchorId: string
): DiffAnchor => {
  const anchor = anchors.get(anchorId);
  if (!anchor) {
    throw new Error("Review finding references an unknown diff anchor");
  }
  return anchor;
};

const toGitHubComment = (
  finding: ReviewFinding,
  anchors: Map<string, DiffAnchor>
): GitHubReviewComment => {
  const end = getAnchor(anchors, finding.anchorId);
  const start = finding.startAnchorId
    ? getAnchor(anchors, finding.startAnchorId)
    : null;
  if (
    start &&
    (start.hunk !== end.hunk ||
      start.path !== end.path ||
      start.side !== end.side ||
      start.line >= end.line)
  ) {
    throw new Error("Review finding has an invalid multi-line anchor range");
  }
  if (finding.suggestion && end.side !== "RIGHT") {
    throw new Error("Suggestions must target the right side of the diff");
  }
  return {
    ...(start ? { start_line: start.line, start_side: start.side } : {}),
    body: renderInlineFinding(finding),
    line: end.line,
    path: end.path,
    side: end.side,
  };
};

const verifyCurrentRun = async (run: ReviewRun): Promise<boolean> => {
  const revision = await getPullRequestRevision(run.repoFullName, run.prNumber);
  if (!(await isActiveReviewRun(run))) {
    if (revision.prRevision !== run.headSha) {
      await supersedeReviewStatus(run, revision.prRevision);
    }
    return false;
  }
  if (revision.prRevision === run.headSha) {
    return true;
  }
  await supersedeReviewStatus(run, revision.prRevision);
  return false;
};

const hasPublishedReview = async (
  run: ReviewRun,
  owner: string,
  repo: string
): Promise<boolean> => {
  const octokit = await getInstallationOctokit();
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    pull_number: run.prNumber,
    repo,
  });
  return reviews.some((review) => review.body?.includes(getReviewMarker(run)));
};

export const publishReview = async (
  input: PublishReviewInput
): Promise<{ outcome: "published" | "superseded" }> => {
  "use step";

  const { anchors, diff, report, run } = input;
  if (!(await verifyCurrentRun(run))) {
    return { outcome: "superseded" };
  }

  const anchorMap = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const comments = report.findings.map((finding) =>
    toGitHubComment(finding, anchorMap)
  );
  const publishingRun = await setReviewRunState(run, "publishing");
  await removeInProgressReaction(publishingRun);

  const { owner, repo } = parseRepositoryName(run.repoFullName);
  const octokit = await getInstallationOctokit();
  if (!(await hasPublishedReview(publishingRun, owner, repo))) {
    await octokit.rest.pulls.createReview({
      body: renderReviewBody(publishingRun, report, {
        changedFiles: getChangedFileCount(diff),
        headSha: run.headSha,
      }),
      comments,
      commit_id: run.headSha,
      event: "COMMENT",
      owner,
      pull_number: run.prNumber,
      repo,
    });
  }
  const completedRun = await setReviewRunState(publishingRun, "completed");
  await completeReviewStatus(completedRun);
  if (report.verdict === "clean") {
    await addCleanReaction(completedRun);
  }
  return { outcome: "published" };
};

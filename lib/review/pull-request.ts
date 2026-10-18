import "server-only";
import { getInstallationOctokit } from "@/lib/github";

export interface PullRequestRevision {
  baseRevision: string;
  prRevision: string;
}

export const parseRepositoryName = (
  repoFullName: string
): { owner: string; repo: string } => {
  const [owner, repo, extra] = repoFullName.split("/");
  if (!owner || !repo || extra) {
    throw new Error("Invalid repository name");
  }
  return { owner, repo };
};

export const getPullRequestRevision = async (
  repoFullName: string,
  prNumber: number
): Promise<PullRequestRevision> => {
  const { owner, repo } = parseRepositoryName(repoFullName);
  const octokit = await getInstallationOctokit();
  const { data } = await octokit.rest.pulls.get({
    owner,
    pull_number: prNumber,
    repo,
  });
  return { baseRevision: data.base.sha, prRevision: data.head.sha };
};

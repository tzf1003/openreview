import { tool } from "ai";
import { z } from "zod";

import { getInstallationOctokit } from "@/lib/github";

const DIFF_CHUNK_CHARACTERS = 8000;

interface DiffChunkOptions {
  baseRevision: string;
  offset: number;
  prRevision: string;
  repoFullName: string;
}

const getPullRequestDiffStep = async (
  options: DiffChunkOptions
): Promise<{
  chunk: string;
  nextOffset: number | null;
  totalCharacters: number;
}> => {
  "use step";

  const { baseRevision, offset, prRevision, repoFullName } = options;
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationOctokit();
  const response = (await octokit.request(
    "GET /repos/{owner}/{repo}/compare/{basehead}",
    {
      basehead: `${baseRevision}...${prRevision}`,
      headers: { accept: "application/vnd.github.v3.diff" },
      owner,
      repo,
    }
  )) as unknown as { data: unknown };
  const { data } = response;

  if (typeof data !== "string") {
    throw new TypeError("GitHub returned an invalid pull request diff");
  }

  const nextOffset = offset + DIFF_CHUNK_CHARACTERS;
  return {
    chunk: data.slice(offset, nextOffset),
    nextOffset: nextOffset < data.length ? nextOffset : null,
    totalCharacters: data.length,
  };
};

export const createPullRequestDiffTool = (
  repoFullName: string,
  baseRevision: string,
  prRevision: string
) =>
  tool({
    description:
      "Read one ordered chunk of the pull request diff. Start at offset 0, then pass each returned nextOffset until it is null.",
    execute: ({ offset }) =>
      getPullRequestDiffStep({
        baseRevision,
        offset,
        prRevision,
        repoFullName,
      }),
    inputSchema: z.object({
      offset: z.number().int().nonnegative().default(0),
    }),
  });

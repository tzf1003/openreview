import "server-only";
import { createHash } from "node:crypto";

import { getInstallationOctokit } from "@/lib/github";

import type { DiffAnchor } from "./types";

const DIFF_CHUNK_CHARACTERS = 12_000;
const MAX_REVIEW_DIFF_CHARACTERS = 500_000;

export interface DiffSnapshot {
  anchors: DiffAnchor[];
  diff: string;
}

interface DiffSnapshotOptions {
  baseRevision: string;
  prRevision: string;
  repoFullName: string;
}

const parseRepository = (
  repoFullName: string
): { owner: string; repo: string } => {
  const [owner, repo, extra] = repoFullName.split("/");
  if (!owner || !repo || extra) {
    throw new Error("Invalid repository name");
  }
  return { owner, repo };
};

const stripDiffPath = (value: string): string =>
  value === "/dev/null" ? value : value.replace(/^[ab]\//, "");

const createAnchorId = (
  revision: string,
  path: string,
  side: DiffAnchor["side"],
  line: number
): string =>
  createHash("sha256")
    .update(`${revision}:${path}:${side}:${line}`)
    .digest("hex")
    .slice(0, 24);

interface DiffParserState {
  filePath: string;
  hunk: number;
  newLine: number;
  oldLine: number;
  oldPath: string;
  offset: number;
}

const createParserState = (): DiffParserState => ({
  filePath: "",
  hunk: 0,
  newLine: 0,
  offset: 0,
  oldLine: 0,
  oldPath: "",
});

const appendAnchor = (
  anchors: DiffAnchor[],
  revision: string,
  state: DiffParserState,
  side: DiffAnchor["side"],
  line: number
): void => {
  anchors.push({
    hunk: state.hunk,
    id: createAnchorId(revision, state.filePath, side, line),
    line,
    offset: state.offset,
    path: state.filePath,
    side,
  });
};

const parseHunk = (line: string, state: DiffParserState): void => {
  const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match || !state.filePath) {
    throw new Error("Unable to parse pull request diff hunk");
  }
  state.oldLine = Number(match[1]);
  state.newLine = Number(match[2]);
  state.hunk += 1;
};

const parseDiffLine = (
  line: string,
  revision: string,
  anchors: DiffAnchor[],
  state: DiffParserState
): void => {
  if (line.startsWith("--- ")) {
    state.oldPath = stripDiffPath(line.slice(4));
  } else if (line.startsWith("+++ ")) {
    const newPath = stripDiffPath(line.slice(4));
    state.filePath = newPath === "/dev/null" ? state.oldPath : newPath;
  } else if (line.startsWith("@@ ")) {
    parseHunk(line, state);
  } else if (line.startsWith("+") && !line.startsWith("+++")) {
    appendAnchor(anchors, revision, state, "RIGHT", state.newLine);
    state.newLine += 1;
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    appendAnchor(anchors, revision, state, "LEFT", state.oldLine);
    state.oldLine += 1;
  } else if (line.startsWith(" ")) {
    appendAnchor(anchors, revision, state, "RIGHT", state.newLine);
    state.newLine += 1;
    state.oldLine += 1;
  }
  state.offset += line.length + 1;
};

const parseAnchors = (diff: string, revision: string): DiffAnchor[] => {
  const anchors: DiffAnchor[] = [];
  const state = createParserState();
  for (const line of diff.split("\n")) {
    parseDiffLine(line, revision, anchors, state);
  }
  return anchors;
};

export const loadDiffSnapshot = async (
  options: DiffSnapshotOptions
): Promise<DiffSnapshot> => {
  "use step";

  const { owner, repo } = parseRepository(options.repoFullName);
  const octokit = await getInstallationOctokit();
  const response = (await octokit.request(
    "GET /repos/{owner}/{repo}/compare/{basehead}",
    {
      basehead: `${options.baseRevision}...${options.prRevision}`,
      headers: { accept: "application/vnd.github.v3.diff" },
      owner,
      repo,
    }
  )) as unknown as { data: unknown };
  if (typeof response.data !== "string") {
    throw new TypeError("GitHub returned an invalid pull request diff");
  }
  if (response.data.length > MAX_REVIEW_DIFF_CHARACTERS) {
    throw new Error("Pull request diff exceeds the review size limit");
  }
  return {
    anchors: parseAnchors(response.data, options.prRevision),
    diff: response.data,
  };
};

const nextChunkEnd = (diff: string, offset: number): number => {
  const target = Math.min(offset + DIFF_CHUNK_CHARACTERS, diff.length);
  const boundary = diff.indexOf("\n", target);
  return boundary === -1 ? diff.length : boundary + 1;
};

export const getDiffChunk = (
  snapshot: DiffSnapshot,
  offset: number
): {
  anchors: Omit<DiffAnchor, "offset">[];
  chunk: string;
  nextOffset: number | null;
  totalCharacters: number;
} => {
  const end = nextChunkEnd(snapshot.diff, offset);
  const anchors = snapshot.anchors
    .filter((anchor) => anchor.offset >= offset && anchor.offset < end)
    .map(({ offset: _offset, ...anchor }) => anchor);
  return {
    anchors,
    chunk: snapshot.diff.slice(offset, end),
    nextOffset: end < snapshot.diff.length ? end : null,
    totalCharacters: snapshot.diff.length,
  };
};

export const getChangedFileCount = (diff: string): number =>
  diff.startsWith("diff --git ") ? diff.split("\ndiff --git ").length : 0;

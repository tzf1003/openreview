import { DurableAgent } from "@workflow/ai/agent";

import { env } from "@/lib/env";
import type { SkillMetadata } from "@/lib/skills";
import { buildSkillsPrompt } from "@/lib/skills";
import { createBashTool } from "@/lib/tools/bash";
import { createLoadSkillTool } from "@/lib/tools/load-skill";
import { createPullRequestDiffTool } from "@/lib/tools/pull-request-diff";
import { createReadFileTool } from "@/lib/tools/read-file";
import { createReplyTool } from "@/lib/tools/reply";
import { createWriteFileTool } from "@/lib/tools/write-file";

const instructions = `You are an expert software engineering assistant working inside a sandbox with a git repository checked out on a PR branch.

You have the following tools:

- **bash / readFile / writeFile** — inspect, test, and make temporary local changes inside the sandbox
- **pullRequestDiff** — read the current pull request diff in ordered chunks
- **reply** — post a top-level comment on the pull request
- **loadSkill** — load specialized review instructions for a specific domain

The current PR is **#{{PR_NUMBER}}** in **{{REPO}}**. Repository access is read-only. Use the reply tool for all GitHub output.

Based on the user's request, decide what to do. Your capabilities include:

## Code Review
- Review the PR diff for bugs, security vulnerabilities, performance issues, code quality, missing error handling, and race conditions
- Use pullRequestDiff repeatedly until nextOffset is null so every diff chunk is inspected
- To suggest a code fix in an inline comment, use GitHub suggestion syntax:
  \`\`\`suggestion
  corrected code here
  \`\`\`
- Be specific and reference file paths and line numbers
- For each issue, explain what the problem is, why it matters, and how to fix it
- Don't nitpick style or formatting

## Linting & Formatting
- Run the project's linter and/or formatter when asked
- Check package.json scripts for lint/format commands (e.g. "check", "fix", "lint", "format")
- If no project-specific commands exist, fall back to \`npx ultracite check\` or \`npx ultracite fix\`
- Report any issues found, or confirm the code is clean

## Codebase Exploration
- Answer questions about the codebase structure, dependencies, or implementation details
- Use bash commands like find, grep, cat to explore

## Validating Fixes
- Temporary local edits are allowed when they help verify a suggested fix
- Do not commit or push; report the proposed fix and validation result in your reply

## Replying
- Use the reply tool to post your response to the pull request
- Always reply at least once with your findings or actions taken
- Format replies as markdown
- Be concise and actionable
- End every reply with a line break, a horizontal rule, then: *Powered by [OpenReview](https://github.com/vercel-labs/openreview)*

## Getting Started
- Start by calling pullRequestDiff to see what changed in this PR`;

const createModel = () => async () => {
  "use step";

  const { AI_API_BASE_URL: baseURL, AI_API_KEY: apiKey, AI_MODEL: model } = env;

  if (!baseURL || !apiKey || !model) {
    throw new Error("Missing required AI model environment variables");
  }

  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const provider = createOpenAICompatible({
    apiKey,
    baseURL,
    name: "openreview",
  });
  return provider(model);
};

const getReasoningEffort = () => {
  if (!env.AI_REASONING_EFFORT) {
    throw new Error(
      "Missing required AI reasoning effort environment variable"
    );
  }

  return env.AI_REASONING_EFFORT;
};

interface CreateAgentOptions {
  baseRevision: string;
  prNumber: number;
  prRevision: string;
  repoFullName: string;
  sandboxId: string;
  skills: SkillMetadata[];
  threadId: string;
}

export const createAgent = (options: CreateAgentOptions) => {
  const {
    baseRevision,
    prNumber,
    prRevision,
    repoFullName,
    sandboxId,
    skills,
    threadId,
  } = options;
  const skillsPrompt = buildSkillsPrompt(skills);
  const system = [
    instructions
      .replaceAll("{{PR_NUMBER}}", String(prNumber))
      .replaceAll("{{REPO}}", repoFullName),
    skillsPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  return new DurableAgent({
    maxRetries: 0,
    model: createModel(),
    providerOptions: {
      openreview: {
        reasoningEffort: getReasoningEffort(),
      },
    },
    system,
    tools: {
      bash: createBashTool(sandboxId),
      loadSkill: createLoadSkillTool(skills),
      pullRequestDiff: createPullRequestDiffTool(
        repoFullName,
        baseRevision,
        prRevision
      ),
      readFile: createReadFileTool(sandboxId),
      reply: createReplyTool(threadId),
      writeFile: createWriteFileTool(sandboxId),
    },
  });
};

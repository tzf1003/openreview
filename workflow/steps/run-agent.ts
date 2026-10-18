import type { UIMessageChunk } from "ai";
import { getWritable } from "workflow";

import { createAgent } from "@/lib/agent";
import { parseError } from "@/lib/error";
import type { ReviewRun } from "@/lib/review/types";
import type { ThreadMessage } from "@/workflow";

import { addPRComment } from "./add-pr-comment";
import { discoverSkills } from "./discover-skills";
import { startTyping } from "./start-typing";

export interface AgentResult {
  errorMessage?: string;
  success: boolean;
}

interface RunAgentOptions {
  baseRevision: string;
  messages: ThreadMessage[];
  prNumber: number;
  prRevision: string;
  repoFullName: string;
  reviewRun?: ReviewRun;
  sandboxId: string;
  threadId: string;
}

const REVIEW_FOOTER = "\n\n---\n*由 Xsec Review 提供*";
const REVIEW_CONCLUSION_TOKEN_BUDGET = 150_000;
const REVIEW_MAX_STEPS = 80;
const REVIEW_TOTAL_TOKEN_BUDGET = 200_000;

interface ReviewStep {
  text: string;
  toolCalls: { toolName: string }[];
  usage: { inputTokens?: number; outputTokens?: number };
}

const hasUsedTool = (
  steps: Pick<ReviewStep, "toolCalls">[],
  toolName: string
): boolean =>
  steps.some((step) =>
    step.toolCalls.some((toolCall) => toolCall.toolName === toolName)
  );

const getTotalTokens = (steps: Pick<ReviewStep, "usage">[]): number =>
  steps.reduce(
    (total, step) =>
      total + (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0),
    0
  );

const publishFinalResponse = async (
  threadId: string,
  steps: ReviewStep[]
): Promise<void> => {
  if (hasUsedTool(steps, "reply")) {
    return;
  }

  await addPRComment(
    threadId,
    `## Xsec Review · 审计完成\n\n✅ **本次变更未发现需要处理的问题。**${REVIEW_FOOTER}`
  );
};

export const runAgent = async (
  options: RunAgentOptions
): Promise<AgentResult> => {
  const {
    baseRevision,
    messages: threadMessages,
    prNumber,
    prRevision,
    repoFullName,
    reviewRun,
    sandboxId,
    threadId,
  } = options;
  const automaticReview = Boolean(reviewRun);
  const outputToolName = automaticReview ? "submitReview" : "reply";

  try {
    if (!automaticReview) {
      await startTyping(threadId, "正在审计");
    }

    const skills = await discoverSkills([".agents/skills"]);

    const { agent, hasReadCompleteDiff } = createAgent({
      baseRevision,
      prNumber,
      prRevision,
      repoFullName,
      reviewRun,
      sandboxId,
      skills,
      threadId,
    });

    const result = await agent.stream({
      maxSteps: REVIEW_MAX_STEPS,
      messages: threadMessages.map((msg) => ({
        content: msg.content,
        role: msg.role,
      })),
      onStepFinish: (step) => {
        console.log(
          `[agent] step: ${step.usage.inputTokens ?? 0} in / ${step.usage.outputTokens ?? 0} out`
        );
      },
      prepareStep: ({ messages, steps }) => {
        const trimmed = messages.map((msg) => {
          if (msg.role !== "tool" || !Array.isArray(msg.content)) {
            return msg;
          }

          return {
            ...msg,
            content: msg.content.map((part) => {
              if (
                part.type !== "tool-result" ||
                part.toolName === "pullRequestDiff"
              ) {
                return part;
              }

              const text = JSON.stringify(part.output);

              if (text.length <= 10_000) {
                return part;
              }

              return {
                ...part,
                output: {
                  type: "text" as const,
                  value: `${text.slice(0, 10_000)}\n\n... (truncated ${text.length - 10_000} chars)`,
                },
              };
            }),
          };
        });

        const reachedConclusionBudget =
          getTotalTokens(steps) >= REVIEW_CONCLUSION_TOKEN_BUDGET;
        if (
          reachedConclusionBudget &&
          (!automaticReview || hasReadCompleteDiff())
        ) {
          return {
            activeTools: [outputToolName],
            messages: trimmed,
            toolChoice: { toolName: outputToolName, type: "tool" },
          };
        }

        return { messages: trimmed };
      },
      stopWhen: [
        ({ steps }) => hasUsedTool(steps, outputToolName),
        ({ steps }) => getTotalTokens(steps) > REVIEW_TOTAL_TOKEN_BUDGET,
      ],
      writable: getWritable<UIMessageChunk>(),
    });

    if (automaticReview && !hasUsedTool(result.steps, outputToolName)) {
      if (!hasReadCompleteDiff()) {
        throw new Error("Automatic review did not read the complete diff");
      }
      throw new Error("Automatic review finished without submitting a result");
    }
    if (!automaticReview) {
      await publishFinalResponse(threadId, result.steps);
    }

    return { success: true };
  } catch (error) {
    return {
      errorMessage: parseError(error),
      success: false,
    };
  }
};

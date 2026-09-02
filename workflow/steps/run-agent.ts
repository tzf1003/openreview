import type { UIMessageChunk } from "ai";
import { getWritable } from "workflow";

import { createAgent } from "@/lib/agent";
import { parseError } from "@/lib/error";
import type { ThreadMessage } from "@/workflow";

import { addPRComment } from "./add-pr-comment";
import { discoverSkills } from "./discover-skills";
import { startTyping } from "./start-typing";

export interface AgentResult {
  errorMessage?: string;
  success: boolean;
}

const REVIEW_FOOTER =
  "\n\n---\n*Powered by [OpenReview](https://github.com/vercel-labs/openreview)*";
const REVIEW_CONCLUSION_TOKEN_BUDGET = 150_000;
const REVIEW_TOTAL_TOKEN_BUDGET = 200_000;

interface ReviewStep {
  text: string;
  toolCalls: { toolName: string }[];
  usage: { inputTokens?: number; outputTokens?: number };
}

const hasPublishedReview = (steps: Pick<ReviewStep, "toolCalls">[]): boolean =>
  steps.some((step) =>
    step.toolCalls.some(({ toolName }) => toolName === "reply")
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
  if (hasPublishedReview(steps)) {
    return;
  }

  await addPRComment(
    threadId,
    `Review completed. No actionable findings were reported.${REVIEW_FOOTER}`
  );
};

export const runAgent = async (
  sandboxId: string,
  threadMessages: ThreadMessage[],
  threadId: string,
  prNumber: number,
  repoFullName: string
): Promise<AgentResult> => {
  try {
    await startTyping(threadId, "Reviewing...");

    const skills = await discoverSkills([".agents/skills"]);

    const agent = createAgent(
      sandboxId,
      threadId,
      prNumber,
      repoFullName,
      skills
    );

    const result = await agent.stream({
      maxSteps: 20,
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
              if (part.type !== "tool-result") {
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

        if (getTotalTokens(steps) >= REVIEW_CONCLUSION_TOKEN_BUDGET) {
          return {
            activeTools: ["reply"],
            messages: trimmed,
            toolChoice: { toolName: "reply", type: "tool" },
          };
        }

        return { messages: trimmed };
      },
      stopWhen: [
        ({ steps }) => hasPublishedReview(steps),
        ({ steps }) => getTotalTokens(steps) > REVIEW_TOTAL_TOKEN_BUDGET,
      ],
      writable: getWritable<UIMessageChunk>(),
    });

    await publishFinalResponse(threadId, result.steps);

    return { success: true };
  } catch (error) {
    return {
      errorMessage: parseError(error),
      success: false,
    };
  }
};

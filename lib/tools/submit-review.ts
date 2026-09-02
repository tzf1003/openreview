import { tool } from "ai";
import { z } from "zod";

import type { DiffSnapshot } from "@/lib/review/anchors";
import { publishReview } from "@/lib/review/publish";
import type { ReviewReport, ReviewRun } from "@/lib/review/types";

const MAX_REVIEW_FINDINGS = 50;
const MAX_TEXT_LENGTH = 4000;

const findingSchema = z.object({
  anchorId: z.string().min(1),
  category: z.string().min(1).max(80),
  explanation: z.string().min(1).max(MAX_TEXT_LENGTH),
  impact: z.string().min(1).max(MAX_TEXT_LENGTH),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  recommendation: z.string().min(1).max(MAX_TEXT_LENGTH),
  startAnchorId: z.string().min(1).optional(),
  suggestion: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
  title: z.string().min(1).max(160),
});

const reviewReportSchema = z
  .object({
    findings: z.array(findingSchema).max(MAX_REVIEW_FINDINGS),
    summary: z.string().min(1).max(MAX_TEXT_LENGTH),
    verdict: z.enum(["clean", "findings"]),
  })
  .superRefine((report, context) => {
    if (report.verdict === "clean" && report.findings.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Clean reviews cannot contain findings",
      });
    }
    if (report.verdict === "findings" && report.findings.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Findings reviews need at least one finding",
      });
    }
  });

interface SubmitReviewOptions {
  getSnapshot: () => Promise<DiffSnapshot>;
  hasReadCompleteDiff: () => boolean;
  run: ReviewRun;
}

// The workflow directive requires a function body.
/* eslint-disable arrow-body-style */
const submitReviewStep = async (
  report: ReviewReport,
  run: ReviewRun,
  snapshot: DiffSnapshot
): Promise<{ outcome: "published" | "superseded" }> => {
  "use step";

  const result = await publishReview({
    anchors: snapshot.anchors,
    diff: snapshot.diff,
    report,
    run,
  });
  return result;
};
/* eslint-enable arrow-body-style */

export const createSubmitReviewTool = (options: SubmitReviewOptions) =>
  tool({
    description:
      "提交本次自动审计的结构化结果。仅在完整读取所有 pullRequestDiff 分片后调用，且只能调用一次。",
    execute: async (report) => {
      if (!options.hasReadCompleteDiff()) {
        throw new Error("Read the complete diff before submitting the review");
      }
      return submitReviewStep(report, options.run, await options.getSnapshot());
    },
    inputSchema: reviewReportSchema,
  });

import type {
  ReviewFinding,
  ReviewReport,
  ReviewRun,
  ReviewScope,
} from "./types";

const REVIEW_FOOTER = "\n\n---\n*由 Xsec Review 提供*";

const sanitizeText = (value: string): string =>
  value.replaceAll("<!--", "&lt;!--").replaceAll("@", "@\u200B").trim();

export const getReviewMarker = (run: ReviewRun): string =>
  `<!-- xsec-review:run=${run.runId} sha=${run.headSha} -->`;

const priorityLabel = (priority: ReviewFinding["priority"]): string => {
  const labels = {
    P0: "🛑 P0",
    P1: "🔴 P1",
    P2: "🟡 P2",
    P3: "🔵 P3",
  };
  return labels[priority];
};

const severityRows = (findings: ReviewFinding[]): string => {
  const counts: Record<ReviewFinding["priority"], number> = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
  };
  for (const finding of findings) {
    counts[finding.priority] += 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(
      ([priority, count]) =>
        `| ${priorityLabel(priority as ReviewFinding["priority"])} | ${count} |`
    )
    .join("\n");
};

export const renderReviewStarted = (run: ReviewRun): string =>
  `## 👀 Xsec Review · 正在审计\n\n正在审计提交 \`${run.headSha.slice(0, 7)}\`，请稍候。\n\n- **审计范围：** 正确性、安全性、可靠性、可维护性\n- **当前状态：** 正在读取变更并验证潜在问题\n\n${getReviewMarker(run)}`;

export const renderReviewCompleted = (run: ReviewRun): string =>
  `## Xsec Review · 审计完成\n\n提交 \`${run.headSha.slice(0, 7)}\` 的审计已完成，结果见下方 Review。\n\n${getReviewMarker(run)}`;

export const renderReviewSuperseded = (
  run: ReviewRun,
  currentHeadSha: string
): string =>
  `## Xsec Review · 已由新提交替代\n\n提交 \`${run.headSha.slice(0, 7)}\` 的审计未发布，因为 PR 已更新至 \`${currentHeadSha.slice(0, 7)}\`。\n\n${getReviewMarker(run)}`;

export const renderReviewFailure = (run: ReviewRun, reason: string): string =>
  `## Xsec Review · 审计未完成\n\n${reason}\n\n${getReviewMarker(run)}`;

export const renderInlineFinding = (finding: ReviewFinding): string => {
  const suggestion = finding.suggestion
    ? `\n\n\`\`\`suggestion\n${finding.suggestion.replaceAll("```", "` ` `")}\n\`\`\``
    : "";
  return `**${priorityLabel(finding.priority)} · ${sanitizeText(finding.title)}**\n\n\`${sanitizeText(finding.category)}\`\n\n${sanitizeText(finding.explanation)}\n\n**影响**\n\n${sanitizeText(finding.impact)}\n\n**建议**\n\n${sanitizeText(finding.recommendation)}${suggestion}`;
};

export const renderReviewBody = (
  run: ReviewRun,
  report: ReviewReport,
  scope: ReviewScope
): string => {
  if (report.verdict === "clean") {
    return `## Xsec Review · 审计完成\n\n✅ **本次变更未发现需要处理的问题。**\n\n<details>\n<summary>审计范围</summary>\n\n- **提交：** \`${scope.headSha.slice(0, 7)}\`\n- **变更：** ${scope.changedFiles} 个文件\n- **检查项：** 正确性、安全性、可靠性、可维护性\n\n</details>\n\n${getReviewMarker(run)}${REVIEW_FOOTER}`;
  }
  return `## Xsec Review · 审计完成\n\n**发现 ${report.findings.length} 个需要处理的问题**\n\n| 优先级 | 数量 |\n|---|---:|\n${severityRows(report.findings)}\n\n所有问题均已评论在对应代码行。\n\n${sanitizeText(report.summary)}\n\n<details>\n<summary>审计范围</summary>\n\n- **提交：** \`${scope.headSha.slice(0, 7)}\`\n- **变更：** ${scope.changedFiles} 个文件\n- **检查项：** 正确性、安全性、可靠性、可维护性\n\n</details>\n\n${getReviewMarker(run)}${REVIEW_FOOTER}`;
};

export const publicReviewFailureReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("diff exceeds")) {
    return "本次变更超过当前审计容量，未生成不完整的审计结论。";
  }
  if (message.includes("REDIS_URL") || message.includes("Redis")) {
    return "审计状态存储不可用，未生成审计结论。";
  }
  if (message.includes("complete diff")) {
    return "未能完整读取本次变更，未生成不完整的审计结论。";
  }
  return "审计过程发生错误，未生成审计结论。请在修复服务后重新触发审计。";
};

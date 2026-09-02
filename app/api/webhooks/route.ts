import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { handlePullRequestWebhook } from "@/lib/auto-review";
import { getBot } from "@/lib/bot";

export const POST = async (request: NextRequest): Promise<Response> => {
  if (request.headers.get("x-github-event") === "pull_request") {
    return handlePullRequestWebhook(request);
  }

  const bot = await getBot();
  const handler = bot.webhooks.github;

  if (!handler) {
    return NextResponse.json(
      { error: "GitHub adapter not configured" },
      { status: 404 }
    );
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
};

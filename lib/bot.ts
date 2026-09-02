import "server-only";
import type { GitHubRawMessage } from "@chat-adapter/github";
import { createGitHubAdapter } from "@chat-adapter/github";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat, emoji } from "chat";
import type { Message, Thread } from "chat";
import { start } from "workflow/api";

import { env } from "@/lib/env";
import { botWorkflow } from "@/workflow";
import type { ThreadMessage, WorkflowParams } from "@/workflow";

import { getAppInfo, getInstallationOctokit } from "./github";

const collectMessages = async (
  thread: Thread<unknown, unknown>
): Promise<ThreadMessage[]> => {
  const messages: ThreadMessage[] = [];

  for await (const msg of thread.allMessages) {
    messages.push({
      content: msg.text,
      role: msg.author.isMe ? "assistant" : "user",
    });
  }

  return messages;
};

interface ThreadState {
  prNumber: number;
  repoFullName: string;
}

const getPullRequestRevisions = async (
  repoFullName: string,
  prNumber: number
): Promise<{ baseRevision: string; prRevision: string }> => {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = repoFullName.split("/");
  const { data } = await octokit.rest.pulls.get({
    owner,
    pull_number: prNumber,
    repo,
  });
  return { baseRevision: data.base.sha, prRevision: data.head.sha };
};

const state = env.REDIS_URL
  ? createRedisState({ url: env.REDIS_URL })
  : createMemoryState();

let botInstance: Chat | null = null;

const handleMention = async (thread: Thread, message: Message) => {
  await thread.adapter.addReaction(thread.id, message.id, emoji.eyes);

  const messages = await collectMessages(thread);
  const raw = message.raw as GitHubRawMessage;

  const repoFullName = raw.repository.full_name;
  const { prNumber } = raw;

  const revisions = await getPullRequestRevisions(repoFullName, prNumber);

  await thread.setState({
    prNumber,
    repoFullName,
  } satisfies ThreadState);

  await start(botWorkflow, [
    {
      ...revisions,
      messages,
      prNumber,
      repoFullName,
      threadId: thread.id,
    } satisfies WorkflowParams,
  ]);
};

const initBot = async (): Promise<Chat> => {
  if (botInstance) {
    return botInstance;
  }

  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_INSTALLATION_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_WEBHOOK_SECRET
  ) {
    throw new Error("Missing required GitHub App environment variables");
  }

  const appInfo = await getAppInfo();

  botInstance = new Chat({
    adapters: {
      github: createGitHubAdapter({
        appId: env.GITHUB_APP_ID,
        botUserId: appInfo.botUserId,
        installationId: env.GITHUB_APP_INSTALLATION_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
        userName: appInfo.slug,
        webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
      }),
    },
    logger: "debug",
    state,
    userName: appInfo.slug,
  });

  botInstance.onNewMention(handleMention);

  botInstance.onSubscribedMessage(async (thread, message) => {
    if (!message.isMention) {
      return;
    }

    await handleMention(thread, message);
  });

  botInstance.onReaction([emoji.thumbs_up, emoji.heart], async (event) => {
    if (!event.added || !event.message?.author.isMe) {
      return;
    }

    const threadState = (await event.thread.state) as ThreadState | null;

    if (!threadState) {
      return;
    }

    const messages = await collectMessages(event.thread);
    const revisions = await getPullRequestRevisions(
      threadState.repoFullName,
      threadState.prNumber
    );

    await start(botWorkflow, [
      {
        ...threadState,
        ...revisions,
        messages,
        threadId: event.thread.id,
      } satisfies WorkflowParams,
    ]);
  });

  botInstance.onReaction([emoji.thumbs_down, emoji.confused], async (event) => {
    if (!event.added || !event.message?.author.isMe) {
      return;
    }

    await event.thread.post(
      `${emoji.eyes} Got it, skipping that. Mention me with feedback if you'd like a different approach.`
    );
  });

  return botInstance;
};

export const getBot = (): Promise<Chat> => initBot();

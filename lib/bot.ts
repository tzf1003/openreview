import "server-only";
import { createGitHubAdapter } from "@chat-adapter/github";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat, emoji } from "chat";
import type { Message, Thread } from "chat";
import { start } from "workflow/api";

import { env } from "@/lib/env";
import { getPullRequestRevision } from "@/lib/review/pull-request";
import { botWorkflow } from "@/workflow";
import type { ThreadMessage, WorkflowParams } from "@/workflow";

import { getAppInfo } from "./github";

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

interface MentionRawMessage {
  prNumber: number;
  repository: { full_name: string };
}

let botInstance: Chat | null = null;
let state: ReturnType<typeof createRedisState> | null = null;
type ReactionEvent = Parameters<Parameters<Chat["onReaction"]>[1]>[0];

const getState = (): ReturnType<typeof createRedisState> => {
  if (!env.REDIS_URL) {
    throw new Error("Missing REDIS_URL for production bot state");
  }
  state ??= createRedisState({ url: env.REDIS_URL });
  return state;
};

const handleMention = async (thread: Thread, message: Message) => {
  const messages = await collectMessages(thread);
  const raw = message.raw as MentionRawMessage;

  const repoFullName = raw.repository.full_name;
  const { prNumber } = raw;

  const revisions = await getPullRequestRevision(repoFullName, prNumber);

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

const handleSubscribedMention = async (thread: Thread, message: Message) => {
  if (!message.isMention) {
    return;
  }
  await handleMention(thread, message);
};

const handlePositiveReaction = async (event: ReactionEvent) => {
  if (!event.added || !event.message?.author.isMe) {
    return;
  }

  const threadState = (await event.thread.state) as ThreadState | null;

  if (!threadState) {
    return;
  }

  const messages = await collectMessages(event.thread);
  const revisions = await getPullRequestRevision(
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
};

const handleNegativeReaction = async (event: ReactionEvent) => {
  if (!event.added || !event.message?.author.isMe) {
    return;
  }

  await event.thread.post(
    `${emoji.eyes} 已跳过该方向。请 @我并说明你希望采用的处理方式。`
  );
};

const registerBotHandlers = (bot: Chat): void => {
  bot.onNewMention(handleMention);
  bot.onSubscribedMessage(handleSubscribedMention);
  bot.onReaction([emoji.thumbs_up, emoji.heart], handlePositiveReaction);
  bot.onReaction([emoji.thumbs_down, emoji.confused], handleNegativeReaction);
};

const createBot = async (): Promise<Chat> => {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_INSTALLATION_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_WEBHOOK_SECRET
  ) {
    throw new Error("Missing required GitHub App environment variables");
  }
  const appInfo = await getAppInfo();
  return new Chat({
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
    state: getState(),
    userName: appInfo.slug,
  });
};

const initBot = async (): Promise<Chat> => {
  if (botInstance) {
    return botInstance;
  }
  botInstance = await createBot();
  registerBotHandlers(botInstance);

  return botInstance;
};

export const getBot = (): Promise<Chat> => initBot();

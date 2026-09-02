import "server-only";
import { createClient } from "redis";
import type { RedisClientType } from "redis";

import { env } from "@/lib/env";

import type { ReviewRun, ReviewState } from "./types";

const ACTIVE_TTL_SECONDS = 60 * 60 * 24 * 7;
const DELIVERY_TTL_SECONDS = 60 * 60 * 24 * 7;
const RUN_TTL_SECONDS = 60 * 60 * 24 * 14;

interface ClaimReviewRunInput {
  deliveryId: string;
  headSha: string;
  prNumber: number;
  repoFullName: string;
  threadId: string;
}

interface ClaimedReviewRun {
  replacedRun: ReviewRun | null;
  run: ReviewRun;
}

let client: RedisClientType | null = null;
let connection: Promise<RedisClientType> | null = null;

const keyPart = (value: string | number): string =>
  encodeURIComponent(String(value));

const activeKey = (repoFullName: string, prNumber: number): string =>
  `xsec-review:active:${keyPart(repoFullName)}:${keyPart(prNumber)}`;

const deliveryKey = (deliveryId: string): string =>
  `xsec-review:delivery:${keyPart(deliveryId)}`;

const runKey = (
  repoFullName: string,
  prNumber: number,
  headSha: string
): string =>
  `xsec-review:run:${keyPart(repoFullName)}:${keyPart(prNumber)}:${keyPart(headSha)}`;

const requireRedisUrl = (): string => {
  if (!env.REDIS_URL) {
    throw new Error("Missing REDIS_URL for review state");
  }
  return env.REDIS_URL;
};

const connectClient = async (
  redis: RedisClientType
): Promise<RedisClientType> => {
  await redis.connect();
  return redis;
};

const connectReviewRedis = (): Promise<RedisClientType> => {
  if (client?.isOpen) {
    return Promise.resolve(client);
  }
  if (!connection) {
    client = createClient({
      socket: { reconnectStrategy: false },
      url: requireRedisUrl(),
    });
    client.on("error", () => console.error("Xsec Review Redis client error"));
    connection = connectClient(client);
  }
  return connection;
};

const readRun = async (
  repoFullName: string,
  prNumber: number,
  headSha: string
): Promise<ReviewRun | null> => {
  const redis = await connectReviewRedis();
  const value = await redis.get(runKey(repoFullName, prNumber, headSha));
  return value ? (JSON.parse(value) as ReviewRun) : null;
};

const writeRun = async (run: ReviewRun): Promise<void> => {
  const redis = await connectReviewRedis();
  await redis.set(
    runKey(run.repoFullName, run.prNumber, run.headSha),
    JSON.stringify(run),
    {
      EX: RUN_TTL_SECONDS,
    }
  );
};

export const getReviewRun = (
  repoFullName: string,
  prNumber: number,
  headSha: string
): Promise<ReviewRun | null> => readRun(repoFullName, prNumber, headSha);

export const claimReviewRun = async (
  input: ClaimReviewRunInput
): Promise<ClaimedReviewRun | null> => {
  const redis = await connectReviewRedis();
  const run: ReviewRun = {
    createdAt: new Date().toISOString(),
    headSha: input.headSha,
    prNumber: input.prNumber,
    repoFullName: input.repoFullName,
    runId: globalThis.crypto.randomUUID(),
    state: "running",
    threadId: input.threadId,
  };
  const result = (await redis.eval(
    `
      if redis.call("EXISTS", KEYS[1]) == 1 then return { 0, "" } end
      redis.call("SET", KEYS[1], "1", "EX", ARGV[1])
      if redis.call("EXISTS", KEYS[2]) == 1 then return { 0, "" } end
      local previous = redis.call("GET", KEYS[3])
      redis.call("SET", KEYS[2], ARGV[4], "EX", ARGV[2])
      redis.call("SET", KEYS[3], ARGV[4], "EX", ARGV[3])
      return { 1, previous or "" }
    `,
    {
      arguments: [
        String(DELIVERY_TTL_SECONDS),
        String(RUN_TTL_SECONDS),
        String(ACTIVE_TTL_SECONDS),
        JSON.stringify(run),
      ],
      keys: [
        deliveryKey(input.deliveryId),
        runKey(run.repoFullName, run.prNumber, run.headSha),
        activeKey(run.repoFullName, run.prNumber),
      ],
    }
  )) as [number, string];
  if (result[0] !== 1) {
    return null;
  }
  return {
    replacedRun: result[1] ? (JSON.parse(result[1]) as ReviewRun) : null,
    run,
  };
};

export const updateReviewRun = async (
  run: ReviewRun,
  changes: Partial<Pick<ReviewRun, "state" | "statusCommentId">>
): Promise<ReviewRun> => {
  const current = await readRun(run.repoFullName, run.prNumber, run.headSha);
  if (!current || current.runId !== run.runId) {
    throw new Error("Review run state is missing or changed");
  }
  const next = { ...current, ...changes };
  await writeRun(next);
  return next;
};

export const isActiveReviewRun = async (run: ReviewRun): Promise<boolean> => {
  const redis = await connectReviewRedis();
  const active = await redis.get(activeKey(run.repoFullName, run.prNumber));
  return active ? (JSON.parse(active) as ReviewRun).runId === run.runId : false;
};

export const setReviewRunState = (
  run: ReviewRun,
  state: ReviewState
): Promise<ReviewRun> => updateReviewRun(run, { state });

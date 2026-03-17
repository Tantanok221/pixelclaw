import {
  GITHUB_MONITOR_HEARTBEAT_MS,
  GITHUB_MONITOR_RETRY_DELAY_MS,
} from "./constants.js";
import type { GithubCredentialSource } from "./githubCredentialSource.js";
import type { GithubClient, GithubMonitoredPullRequest } from "./githubClient.js";
import { ChatRepository } from "./repository.js";

export interface StartGithubMonitorPollerOptions {
  repository: ChatRepository;
  githubClient: GithubClient;
  githubCredentialSource: GithubCredentialSource;
  heartbeatMs?: number;
  retryDelayMs?: number;
}

export async function startGithubMonitorPoller(
  options: StartGithubMonitorPollerOptions,
): Promise<{ close: () => Promise<void> }> {
  const heartbeatMs = options.heartbeatMs ?? GITHUB_MONITOR_HEARTBEAT_MS;
  const retryDelayMs = options.retryDelayMs ?? GITHUB_MONITOR_RETRY_DELAY_MS;
  let isClosed = false;
  const activeMonitorIds = new Set<string>();
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let activeDelayResolver: (() => void) | null = null;

  const loop = (async () => {
    while (!isClosed) {
      try {
        const dueMonitors = await options.repository.listDueMonitors();

        for (const monitor of dueMonitors) {
          if (isClosed || activeMonitorIds.has(monitor.id)) {
            continue;
          }

          activeMonitorIds.add(monitor.id);
          void pollGithubMonitor({
            repository: options.repository,
            githubCredentialSource: options.githubCredentialSource,
            githubClient: options.githubClient,
            monitorId: monitor.id,
          })
            .catch(async (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              await options.repository.updateMonitorPollingState(monitor.id, {
                status: "error",
                lastError: message,
                nextPollAt: addMilliseconds(retryDelayMs),
                updatedAt: new Date().toISOString(),
              });
            })
            .finally(() => {
              activeMonitorIds.delete(monitor.id);
            });
        }

        await delay(heartbeatMs, {
          onTimer: (timer) => {
            activeTimer = timer;
          },
          onResolve: (resolve) => {
            activeDelayResolver = resolve;
          },
        });
        activeTimer = null;
        activeDelayResolver = null;
      } catch {
        await delay(retryDelayMs, {
          onTimer: (timer) => {
            activeTimer = timer;
          },
          onResolve: (resolve) => {
            activeDelayResolver = resolve;
          },
        });
        activeTimer = null;
        activeDelayResolver = null;
      }
    }
  })();

  return {
    close: async () => {
      isClosed = true;
      if (activeTimer) {
        clearTimeout(activeTimer);
      }
      activeDelayResolver?.();
      await loop;
    },
  };
}

export async function pollGithubMonitor(options: {
  repository: ChatRepository;
  githubCredentialSource: GithubCredentialSource;
  githubClient: GithubClient;
  monitorId: string;
}) {
  const context = await options.repository.getMonitorWithAccount(options.monitorId);
  if (!context) {
    throw new Error(`Monitor not found: ${options.monitorId}`);
  }

  const { monitor, githubAccount } = context;
  const accessToken = await options.githubCredentialSource.getAccessToken({
    hostname: githubAccount.hostname,
    login: githubAccount.login,
  });
  const currentSnapshots = await options.repository.listMonitorPrSnapshots(monitor.id);
  const snapshotByPrNumber = new Map(currentSnapshots.map((snapshot) => [snapshot.prNumber, snapshot]));
  const remotePullRequests = await options.githubClient.listMonitoredPullRequests({
    accessToken,
    owner: monitor.owner,
    repo: monitor.repo,
    authorLogin: githubAccount.login,
  });
  const activePrNumbers = new Set<number>();

  for (const pullRequest of remotePullRequests) {
    activePrNumbers.add(pullRequest.number);
    const previous = snapshotByPrNumber.get(pullRequest.number) ?? null;

    if (previous) {
      await createNotificationsForTransition(options.repository, monitor, pullRequest, previous);
    }

    await options.repository.upsertMonitorPrSnapshot(monitor.id, {
      prNumber: pullRequest.number,
      prTitle: pullRequest.title,
      prUrl: pullRequest.url,
      headSha: pullRequest.headSha,
      mergeableState: pullRequest.mergeableState,
      checksState: pullRequest.checksState,
      latestExternalCommentId: pullRequest.latestExternalComment?.id ?? null,
      latestExternalCommentAuthorLogin: pullRequest.latestExternalComment?.authorLogin ?? null,
      latestExternalCommentBody: pullRequest.latestExternalComment?.body ?? null,
      latestExternalCommentUrl: pullRequest.latestExternalComment?.url ?? null,
      latestExternalCommentCreatedAt: pullRequest.latestExternalComment?.createdAt ?? null,
    });
  }

  for (const snapshot of currentSnapshots) {
    if (!activePrNumbers.has(snapshot.prNumber)) {
      await options.repository.deleteMonitorPrSnapshot(snapshot.id);
    }
  }

  await options.repository.updateMonitorPollingState(monitor.id, {
    status: "active",
    lastError: null,
    lastPolledAt: new Date().toISOString(),
    nextPollAt: addSeconds(monitor.pollIntervalSeconds),
    updatedAt: new Date().toISOString(),
  });
}

async function createNotificationsForTransition(
  repository: ChatRepository,
  monitor: {
    id: string;
    owner: string;
    repo: string;
  },
  next: GithubMonitoredPullRequest,
  previous: {
    headSha: string;
    mergeableState: string | null;
    checksState: string;
    latestExternalCommentId: string | null;
  },
) {
  const repoName = `${monitor.owner}/${monitor.repo}`;

  if (next.latestExternalComment?.id && next.latestExternalComment.id !== previous.latestExternalCommentId) {
    await repository.createMonitorNotification({
      monitorId: monitor.id,
      provider: "github",
      eventType: "comment.created",
      title: `${repoName}: new comment on PR #${next.number}`,
      payload: {
        prNumber: next.number,
        repo: repoName,
        prTitle: next.title,
        prUrl: next.url,
        comment: next.latestExternalComment,
      },
      sourceKey: `github:${repoName}:pr-${next.number}:comment_created:${next.latestExternalComment.id}`,
    });
  }

  const nextIsFailing = next.checksState === "failing";
  const previousWasFailing = previous.checksState === "failing";
  if (nextIsFailing && (!previousWasFailing || previous.headSha !== next.headSha)) {
    await repository.createMonitorNotification({
      monitorId: monitor.id,
      provider: "github",
      eventType: "checks.failed",
      title: `${repoName}: checks failed on PR #${next.number}`,
      payload: {
        prNumber: next.number,
        repo: repoName,
        prTitle: next.title,
        prUrl: next.url,
        headSha: next.headSha,
      },
      sourceKey: `github:${repoName}:pr-${next.number}:checks_failed:${next.headSha}`,
    });
  }

  const nextHasConflict = next.mergeableState === "dirty";
  const previousHadConflict = previous.mergeableState === "dirty";
  if (nextHasConflict && (!previousHadConflict || previous.headSha !== next.headSha)) {
    await repository.createMonitorNotification({
      monitorId: monitor.id,
      provider: "github",
      eventType: "merge_conflict.detected",
      title: `${repoName}: PR #${next.number} has merge conflicts`,
      payload: {
        prNumber: next.number,
        repo: repoName,
        prTitle: next.title,
        prUrl: next.url,
        headSha: next.headSha,
      },
      sourceKey: `github:${repoName}:pr-${next.number}:merge_conflict:${next.headSha}`,
    });
  }
}

function addSeconds(seconds: number) {
  return addMilliseconds(seconds * 1000);
}

function addMilliseconds(durationMs: number) {
  return new Date(Date.now() + durationMs).toISOString();
}

function delay(
  durationMs: number,
  callbacks?: {
    onTimer?: (timer: ReturnType<typeof setTimeout>) => void;
    onResolve?: (resolve: () => void) => void;
  },
) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    timer.unref?.();
    callbacks?.onTimer?.(timer);
    callbacks?.onResolve?.(resolve);
  });
}

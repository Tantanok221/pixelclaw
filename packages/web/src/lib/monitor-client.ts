export interface OverviewResponse {
  counts: {
    activeRuns: number;
    failedRunsLast24Hours: number;
    runsLast24Hours: number;
    activeSessions: number;
  };
}

export interface AdminRunSummary {
  id: string;
  threadId: string;
  threadTitle: string;
  sessionId: string;
  status: string;
  source: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  latestEventType: string | null;
  latestEventAt: string;
  preview: string;
}

export interface AdminRunDetail {
  run: {
    id: string;
    threadId: string;
    threadTitle: string;
    sessionId: string;
    status: string;
    source: string;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    latestEventType: string | null;
  };
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    status: "pending" | "streaming" | "completed" | "error";
    createdAt?: string;
  }>;
}

export interface AdminRunEvent {
  id: string;
  runId: string;
  threadId: string;
  sessionId: string;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MonitorNotification {
  id: string;
  eventId: string;
  monitorId: string;
  provider: string;
  eventType: string;
  title: string;
  payload: Record<string, unknown>;
  sourceKey: string;
  status: string;
  createdAt: string;
  readAt: string | null;
}

export interface GithubAccount {
  id: string;
  providerUserId: string;
  hostname: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  tokenSource: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubRepositorySummary {
  owner: string;
  name: string;
  fullName: string;
}

export interface MonitorSummary {
  id: string;
  provider: string;
  githubAccountId: string;
  owner: string;
  repo: string;
  name: string;
  status: string;
  pollIntervalSeconds: number;
  nextPollAt: string;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
}

export interface MonitorClient {
  getOverview(): Promise<OverviewResponse>;
  listRuns(): Promise<AdminRunSummary[]>;
  getRun(runId: string): Promise<AdminRunDetail>;
  getRunEvents(runId: string): Promise<{ events: AdminRunEvent[] }>;
  getNotifications(): Promise<MonitorNotification[]>;
  getGithubAccounts(): Promise<GithubAccount[]>;
  getGithubRepositories(githubAccountId: string): Promise<GithubRepositorySummary[]>;
  syncGithubAccounts(): Promise<GithubAccount[]>;
  getMonitors(): Promise<MonitorSummary[]>;
  createMonitor(input: {
    githubAccountId: string;
    repository: string;
  }): Promise<MonitorSummary>;
  subscribeToNotifications(onNotification: (notification: MonitorNotification) => void): () => void;
}

export function createMonitorClient(baseUrl = ""): MonitorClient {
  return {
    async getOverview() {
      return fetchJson<OverviewResponse>(`${baseUrl}/api/admin/overview`);
    },

    async listRuns() {
      const response = await fetchJson<{ runs: AdminRunSummary[] }>(`${baseUrl}/api/admin/runs`);
      return response.runs;
    },

    async getRun(runId) {
      return fetchJson<AdminRunDetail>(`${baseUrl}/api/admin/runs/${runId}`);
    },

    async getRunEvents(runId) {
      return fetchJson<{ events: AdminRunEvent[] }>(`${baseUrl}/api/admin/runs/${runId}/events`);
    },

    async getNotifications() {
      const response = await fetchJson<{ notifications: MonitorNotification[] }>(`${baseUrl}/api/notifications`);
      return response.notifications;
    },

    async getGithubAccounts() {
      const response = await fetchJson<{ accounts: GithubAccount[] }>(`${baseUrl}/api/monitor/github/accounts`);
      return response.accounts;
    },

    async getGithubRepositories(githubAccountId) {
      const response = await fetchJson<{ repositories: GithubRepositorySummary[] }>(
        `${baseUrl}/api/monitor/github/accounts/${githubAccountId}/repositories`,
      );
      return response.repositories;
    },

    async syncGithubAccounts() {
      const response = await fetchJson<{ accounts: GithubAccount[] }>(`${baseUrl}/api/monitor/github/accounts/sync`, {
        method: "POST",
      });
      return response.accounts;
    },

    async getMonitors() {
      const response = await fetchJson<{ monitors: MonitorSummary[] }>(`${baseUrl}/api/monitors`);
      return response.monitors;
    },

    async createMonitor(input) {
      const response = await fetchJson<{ monitor: MonitorSummary }>(`${baseUrl}/api/monitors`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      return response.monitor;
    },

    subscribeToNotifications(onNotification) {
      const stream = new EventSource(`${baseUrl}/api/notifications/stream`);
      const listener = (event: MessageEvent<string>) => {
        onNotification(JSON.parse(event.data) as MonitorNotification);
      };

      stream.addEventListener("notification.created", listener as EventListener);
      stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED) {
          stream.close();
        }
      };

      return () => {
        stream.removeEventListener("notification.created", listener as EventListener);
        stream.close();
      };
    },
  };
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

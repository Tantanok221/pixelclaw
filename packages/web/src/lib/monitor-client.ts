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

export interface MonitorClient {
  getOverview(): Promise<OverviewResponse>;
  listRuns(): Promise<AdminRunSummary[]>;
  getRun(runId: string): Promise<AdminRunDetail>;
  getRunEvents(runId: string): Promise<{ events: AdminRunEvent[] }>;
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
  };
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

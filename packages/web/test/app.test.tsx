import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type {
  GithubRepositorySummary,
  MonitorNotification,
  MonitorSummary,
} from "../src/lib/monitor-client.js";

class FakeMonitorClient {
  private readonly githubAccounts = [
    {
      id: "account-1",
      providerUserId: "12345",
      hostname: "github.com",
      login: "tantanok",
      displayName: "Tan Tanok",
      avatarUrl: "https://avatars.example/tantanok.png",
      scopes: ["repo", "read:user"],
      tokenSource: "keyring",
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  ];
  private readonly monitors: MonitorSummary[] = [
    {
      id: "monitor-1",
      provider: "github",
      githubAccountId: "account-1",
      owner: "pixelclaw",
      repo: "web",
      name: "My web PRs",
      status: "active",
      pollIntervalSeconds: 45,
      nextPollAt: "2026-03-09T10:31:00.000Z",
      lastPolledAt: "2026-03-09T10:30:30.000Z",
      lastError: null,
      createdAt: "2026-03-09T10:05:00.000Z",
      updatedAt: "2026-03-09T10:30:30.000Z",
      unreadCount: 1,
    },
  ];
  private readonly notifications: MonitorNotification[] = [
    {
      id: "notification-1",
      eventId: "event-1",
      monitorId: "monitor-1",
      provider: "github",
      eventType: "checks.failed",
      title: "pixelclaw/web: checks failed on PR #42",
      payload: { prNumber: 42, repo: "pixelclaw/web" },
      sourceKey: "github:pixelclaw/web:pr-42:checks_failed:sha-1",
      status: "unread",
      createdAt: "2026-03-09T10:32:00.000Z",
      readAt: null,
    },
  ];
  private readonly githubRepositoriesByAccountId: Record<string, GithubRepositorySummary[]> = {
    "account-1": [
      {
        owner: "pixelclaw",
        name: "server",
        fullName: "pixelclaw/server",
      },
      {
        owner: "pixelclaw",
        name: "web",
        fullName: "pixelclaw/web",
      },
    ],
  };
  private readonly notificationListeners = new Set<(notification: MonitorNotification) => void>();

  async getOverview() {
    return {
      counts: {
        activeRuns: 1,
        failedRunsLast24Hours: 1,
        runsLast24Hours: 2,
        activeSessions: 1,
      },
    };
  }

  async listRuns() {
    return [
      {
        id: "run-2",
        threadId: "thread-2",
        threadTitle: "Telegram triage",
        sessionId: "session-2",
        status: "failed",
        source: "telegram",
        error: "Tool failed",
        startedAt: "2026-03-09T10:31:00.000Z",
        finishedAt: "2026-03-09T10:31:05.000Z",
        latestEventType: "run.failed",
        latestEventAt: "2026-03-09T10:31:05.000Z",
        preview: "Tool failed",
      },
      {
        id: "run-1",
        threadId: "thread-1",
        threadTitle: "Filesystem audit",
        sessionId: "session-1",
        status: "streaming",
        source: "web",
        error: null,
        startedAt: "2026-03-09T10:30:00.000Z",
        finishedAt: null,
        latestEventType: "tool.started",
        latestEventAt: "2026-03-09T10:30:02.000Z",
        preview: "Inspecting current workspace",
      },
    ];
  }

  async getRun(runId: string) {
    if (runId === "run-2") {
      return {
        run: {
          id: "run-2",
          threadId: "thread-2",
          threadTitle: "Telegram triage",
          sessionId: "session-2",
          status: "failed",
          source: "telegram",
          error: "Tool failed",
          startedAt: "2026-03-09T10:31:00.000Z",
          finishedAt: "2026-03-09T10:31:05.000Z",
          latestEventType: "run.failed",
        },
        messages: [
          {
            id: "m-3",
            role: "user",
            content: "Check Telegram issue",
            status: "completed",
            createdAt: "2026-03-09T10:31:00.000Z",
          },
          {
            id: "m-4",
            role: "assistant",
            content: "",
            status: "error",
            createdAt: "2026-03-09T10:31:05.000Z",
          },
        ],
      };
    }

    return {
      run: {
        id: "run-1",
        threadId: "thread-1",
        threadTitle: "Filesystem audit",
        sessionId: "session-1",
        status: "streaming",
        source: "web",
        error: null,
        startedAt: "2026-03-09T10:30:00.000Z",
        finishedAt: null,
        latestEventType: "tool.started",
      },
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Audit the project",
          status: "completed",
          createdAt: "2026-03-09T10:30:00.000Z",
        },
        {
          id: "m-2",
          role: "assistant",
          content: "Inspecting current workspace",
          status: "streaming",
          createdAt: "2026-03-09T10:30:02.000Z",
        },
      ],
    };
  }

  async getRunEvents(runId: string) {
    if (runId === "run-2") {
      return {
        events: [
          {
            id: "e-4",
            runId,
            threadId: "thread-2",
            sessionId: "session-2",
            source: "telegram",
            type: "run.started",
            payload: {},
            createdAt: "2026-03-09T10:31:00.000Z",
          },
          {
            id: "e-5",
            runId,
            threadId: "thread-2",
            sessionId: "session-2",
            source: "telegram",
            type: "run.failed",
            payload: { error: "Tool failed" },
            createdAt: "2026-03-09T10:31:05.000Z",
          },
        ],
      };
    }

    return {
      events: [
        {
          id: "e-1",
          runId,
          threadId: "thread-1",
          sessionId: "session-1",
          source: "web",
          type: "run.started",
          payload: {},
          createdAt: "2026-03-09T10:30:00.000Z",
        },
        {
          id: "e-2",
          runId,
          threadId: "thread-1",
          sessionId: "session-1",
          source: "web",
          type: "run.state.changed",
          payload: { state: "planning" },
          createdAt: "2026-03-09T10:30:01.000Z",
        },
        {
          id: "e-3",
          runId,
          threadId: "thread-1",
          sessionId: "session-1",
          source: "web",
          type: "tool.started",
          payload: { toolName: "read", args: { path: "README.md" } },
          createdAt: "2026-03-09T10:30:02.000Z",
        },
      ],
    };
  }

  async getNotifications() {
    return this.notifications;
  }

  async getGithubAccounts() {
    return this.githubAccounts;
  }

  async syncGithubAccounts() {
    return this.githubAccounts;
  }

  async getMonitors() {
    return this.monitors;
  }

  async getGithubRepositories(githubAccountId: string) {
    return this.githubRepositoriesByAccountId[githubAccountId] ?? [];
  }

  async createMonitor(input: {
    githubAccountId: string;
    repository: string;
  }) {
    const [owner, repo] = input.repository.split("/");
    const monitor = {
      id: `monitor-${this.monitors.length + 1}`,
      provider: "github",
      githubAccountId: input.githubAccountId,
      owner,
      repo,
      name: `${repo} PRs`,
      status: "active",
      pollIntervalSeconds: 45,
      nextPollAt: "2026-03-09T10:40:00.000Z",
      lastPolledAt: null,
      lastError: null,
      createdAt: "2026-03-09T10:35:00.000Z",
      updatedAt: "2026-03-09T10:35:00.000Z",
      unreadCount: 0,
    };
    this.monitors.unshift(monitor);
    return monitor;
  }

  subscribeToNotifications(onNotification: (notification: MonitorNotification) => void) {
    this.notificationListeners.add(onNotification);
    return () => {
      this.notificationListeners.delete(onNotification);
    };
  }

  emitNotification(notification: MonitorNotification) {
    this.notifications.unshift(notification);
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  async listThreads() {
    return [];
  }

  async createThread() {
    return { threadId: "unused" };
  }

  async getMessages() {
    return { threadId: "unused", messages: [] };
  }

  async sendMessage() {
    return {
      threadId: "unused",
      runId: "unused",
      assistantMessageId: "unused",
    };
  }

  async streamRun() {}
}

describe("admin monitor dashboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    window.history.replaceState({}, "", "/");
  });

  it("renders the active sessions home view on load", async () => {
    render(<App client={new FakeMonitorClient() as never} />);

    expect(await screen.findByRole("heading", { name: /operations monitor/i })).toBeInTheDocument();
    const sidebar = await screen.findByRole("complementary");
    const main = await screen.findByRole("main");
    expect(await screen.findByRole("heading", { name: /active sessions/i })).toBeInTheDocument();
    expect(await screen.findByText("session-1")).toBeInTheDocument();
    expect((await screen.findAllByText("Filesystem audit")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Inspecting current workspace")).length).toBeGreaterThan(0);
    expect(within(sidebar).queryByText("Runs (24h)")).not.toBeInTheDocument();
    expect(await within(main).findByText("Runs (24h)")).toBeInTheDocument();
    expect(within(main).getByText("2")).toBeInTheDocument();
  });

  it("defaults to dark mode and lets the operator switch to light mode", async () => {
    const user = userEvent.setup();
    render(<App client={new FakeMonitorClient() as never} />);

    expect(document.documentElement).toHaveClass("dark");

    await user.click(await screen.findByRole("button", { name: /switch to light mode/i }));

    await waitFor(() => {
      expect(document.documentElement).not.toHaveClass("dark");
      expect(window.localStorage.getItem("monitor-theme")).toBe("light");
    });

    expect(await screen.findByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it("switches runs and shows the selected run transcript and audit failure", async () => {
    const user = userEvent.setup();
    render(<App client={new FakeMonitorClient() as never} />);

    await user.click(await screen.findByRole("button", { name: /telegram triage/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/chats/thread-2");
      expect(screen.getAllByText("Tool failed").length).toBeGreaterThan(0);
      expect(screen.getAllByText("run.failed").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/telegram/i).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: /transcript/i }));

    await waitFor(() => {
      expect(screen.getByText("Check Telegram issue")).toBeInTheDocument();
    });
  });

  it("returns to the overview from the sidebar", async () => {
    const user = userEvent.setup();
    render(<App client={new FakeMonitorClient() as never} />);

    await user.click(await screen.findByRole("button", { name: /filesystem audit/i }));
    expect((await screen.findAllByText("tool.started")).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/chats/thread-1");

    await user.click(screen.getByRole("button", { name: /overview/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByRole("heading", { name: /active sessions/i })).toBeInTheDocument();
      expect(screen.getByText(/use this page as the primary surface for live activity/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /transcript/i })).not.toBeInTheDocument();
    });
  });

  it("loads the matching chat route directly", async () => {
    window.history.replaceState({}, "", "/chats/thread-2");

    render(<App client={new FakeMonitorClient() as never} />);

    await waitFor(() => {
      expect(screen.getAllByText("Tool failed").length).toBeGreaterThan(0);
      expect(screen.getAllByText("run.failed").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/telegram triage/i).length).toBeGreaterThan(0);
    });
  });

  it("limits recent runs to ten items until show more is pressed", async () => {
    const user = userEvent.setup();
    const manyRunsClient = new FakeMonitorClient();
    manyRunsClient.listRuns = async () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: `run-${index + 1}`,
        threadId: `thread-${index + 1}`,
        threadTitle: `Run ${index + 1}`,
        sessionId: `session-${index + 1}`,
        status: index % 2 === 0 ? "streaming" : "completed",
        source: "web",
        error: null,
        startedAt: "2026-03-09T10:30:00.000Z",
        finishedAt: null,
        latestEventType: "tool.started",
        latestEventAt: "2026-03-09T10:30:02.000Z",
        preview: `Preview ${index + 1}`,
      }));

    render(<App client={manyRunsClient as never} />);

    const sidebar = await screen.findByRole("complementary");
    expect(await within(sidebar).findByRole("button", { name: /run 10/i })).toBeInTheDocument();
    expect(within(sidebar).queryByRole("button", { name: /run 11/i })).not.toBeInTheDocument();

    await user.click(within(sidebar).getByRole("button", { name: /show more/i }));

    expect(within(sidebar).getByRole("button", { name: /run 11/i })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: /run 12/i })).toBeInTheDocument();
  });

  it("renders monitor notifications and appends new ones from the live stream", async () => {
    const client = new FakeMonitorClient();
    render(<App client={client as never} />);

    expect(await screen.findByText("pixelclaw/web: checks failed on PR #42")).toBeInTheDocument();
    expect(await screen.findByText("1 unread alert")).toBeInTheDocument();

    await act(async () => {
      client.emitNotification({
        id: "notification-2",
        eventId: "event-2",
        monitorId: "monitor-1",
        provider: "github",
        eventType: "comment.created",
        title: "pixelclaw/web: new comment on PR #42",
        payload: { prNumber: 42, repo: "pixelclaw/web" },
        sourceKey: "github:pixelclaw/web:pr-42:comment_created:comment-8",
        status: "unread",
        createdAt: "2026-03-09T10:33:00.000Z",
        readAt: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("pixelclaw/web: new comment on PR #42")).toBeInTheDocument();
      expect(screen.getByText("2 unread alerts")).toBeInTheDocument();
    });
  });

  it("renders connected GitHub accounts and lets the user create a monitor", async () => {
    const user = userEvent.setup();
    const client = new FakeMonitorClient();
    render(<App client={client as never} />);

    expect(await screen.findByText("Connected accounts")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /sync gh accounts/i })).toBeInTheDocument();
    expect((await screen.findAllByText("@tantanok")).length).toBeGreaterThan(0);
    expect(await screen.findByText("My web PRs")).toBeInTheDocument();
    expect(await screen.findByText("1 unread")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("GitHub account"), "account-1");

    expect(screen.queryByLabelText("Repository owner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Monitor name")).not.toBeInTheDocument();

    await user.selectOptions(await screen.findByLabelText("Repository"), "pixelclaw/server");
    await user.click(screen.getByRole("button", { name: /create monitor/i }));

    await waitFor(() => {
      expect(screen.getByText("server PRs")).toBeInTheDocument();
      expect(screen.getAllByText("pixelclaw/server").length).toBeGreaterThan(0);
    });
  });
});

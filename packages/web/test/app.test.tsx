import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

class FakeMonitorClient {
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
});

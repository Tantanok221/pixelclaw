import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { ChatClient, ChatMessage, ThreadSummary } from "../src/lib/chat-client.js";

class FakeChatClient implements ChatClient {
  constructor(
    private readonly state: {
      threads: ThreadSummary[];
      messagesByThread: Record<string, ChatMessage[]>;
    },
  ) {}

  async listThreads() {
    return this.state.threads;
  }

  async createThread() {
    const thread = {
      id: "thread-new",
      title: "New chat",
    };
    this.state.threads = [thread, ...this.state.threads];
    this.state.messagesByThread[thread.id] = [];
    return { threadId: thread.id };
  }

  async getMessages(threadId: string) {
    return {
      threadId,
      messages: this.state.messagesByThread[threadId] ?? [],
    };
  }

  async sendMessage(input: { threadId?: string; content: string }) {
    const threadId = input.threadId ?? this.state.threads[0]?.id ?? "thread-1";
    const messages = this.state.messagesByThread[threadId] ?? [];
    messages.push({
      id: "user-2",
      role: "user",
      content: input.content,
      status: "completed",
    });
    this.state.messagesByThread[threadId] = messages;
    return {
      threadId,
      runId: "run-1",
      assistantMessageId: "assistant-2",
    };
  }

  async streamRun(
    _runId: string,
    handlers: {
      onDelta: (delta: string) => void;
      onCompleted: (text: string) => void;
      onFailed: (error: string) => void;
    },
  ) {
    handlers.onDelta("Hello");
    handlers.onDelta(" there");
    handlers.onCompleted("Hello there");
  }
}

describe("chat app", () => {
  it("renders the thread list and loads the selected thread transcript", async () => {
    const client = new FakeChatClient({
      threads: [
        { id: "thread-1", title: "Debugging notes" },
        { id: "thread-2", title: "Pixelbot ideas" },
      ],
      messagesByThread: {
        "thread-1": [
          { id: "m1", role: "user", content: "First prompt", status: "completed" },
          { id: "m2", role: "assistant", content: "First answer", status: "completed" },
        ],
        "thread-2": [{ id: "m3", role: "user", content: "Second prompt", status: "completed" }],
      },
    });

    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: /pixelclaw chat/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /debugging notes/i })).toBeInTheDocument();
    expect(await screen.findByText("First answer")).toBeInTheDocument();
  });

  it("sends a message and renders the streamed assistant reply", async () => {
    const user = userEvent.setup();
    const client = new FakeChatClient({
      threads: [{ id: "thread-1", title: "Debugging notes" }],
      messagesByThread: {
        "thread-1": [],
      },
    });

    render(<App client={client} />);

    const composer = await screen.findByLabelText(/message composer/i);
    await user.type(composer, "Ship the frontend");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText("Ship the frontend")).toBeInTheDocument();
      expect(screen.getByText("Hello there")).toBeInTheDocument();
    });
  });
});

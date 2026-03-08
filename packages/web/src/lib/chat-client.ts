export interface ThreadSummary {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "streaming" | "completed" | "error";
  createdAt?: string;
}

export interface ChatClient {
  listThreads(): Promise<ThreadSummary[]>;
  createThread(): Promise<{ threadId: string }>;
  getMessages(threadId: string): Promise<{ threadId: string; messages: ChatMessage[] }>;
  sendMessage(input: { threadId?: string; content: string }): Promise<{
    threadId: string;
    runId: string;
    assistantMessageId: string;
  }>;
  streamRun(
    runId: string,
    handlers: {
      onDelta: (delta: string) => void;
      onCompleted: (text: string) => void;
      onFailed: (error: string) => void;
    },
  ): Promise<void>;
}

export function createChatClient(baseUrl = ""): ChatClient {
  return {
    async listThreads() {
      const response = await fetchJson<{ threads: ThreadSummary[] }>(`${baseUrl}/api/chat/threads`, {
        credentials: "include",
      });
      return response.threads;
    },

    async createThread() {
      return fetchJson<{ threadId: string }>(`${baseUrl}/api/chat/threads`, {
        method: "POST",
        credentials: "include",
      });
    },

    async getMessages(threadId) {
      return fetchJson<{ threadId: string; messages: ChatMessage[] }>(
        `${baseUrl}/api/chat/threads/${threadId}/messages`,
        {
          credentials: "include",
        },
      );
    },

    async sendMessage(input) {
      return fetchJson<{
        threadId: string;
        runId: string;
        assistantMessageId: string;
      }>(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
    },

    async streamRun(runId, handlers) {
      const response = await fetch(`${baseUrl}/api/chat/runs/${runId}/stream`, {
        credentials: "include",
        headers: {
          Accept: "text/event-stream",
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`Unable to stream run ${runId}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const parsed = parseSseFrame(frame);
          if (!parsed) {
            continue;
          }

          if (parsed.event === "message.delta") {
            handlers.onDelta(parsed.data.delta ?? "");
            continue;
          }

          if (parsed.event === "message.completed") {
            handlers.onCompleted(parsed.data.text ?? "");
            continue;
          }

          if (parsed.event === "run.failed") {
            handlers.onFailed(parsed.data.error ?? "Unknown error");
          }
        }
      }
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

function parseSseFrame(frame: string) {
  const lines = frame.split("\n");
  let event = "";
  let data = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }

  if (!event) {
    return null;
  }

  return {
    event,
    data: data ? (JSON.parse(data) as Record<string, string>) : {},
  };
}

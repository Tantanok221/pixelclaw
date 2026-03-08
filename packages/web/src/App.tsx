import { LoaderCircle, MessageSquarePlus, PanelLeft, SendHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Card } from "./components/ui/card.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Textarea } from "./components/ui/textarea.js";
import { createChatClient, type ChatClient, type ChatMessage, type ThreadSummary } from "./lib/chat-client.js";
import { cn } from "./lib/utils.js";

export interface AppProps {
  client?: ChatClient;
}

export function App({ client }: AppProps) {
  const [resolvedClient] = useState(() => client ?? createChatClient());
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      const nextThreads = await resolvedClient.listThreads();
      if (!isMounted) {
        return;
      }

      setThreads([...nextThreads]);
      if (nextThreads[0]) {
        setSelectedThreadId(nextThreads[0].id);
        const thread = await resolvedClient.getMessages(nextThreads[0].id);
        if (!isMounted) {
          return;
        }
        setMessages([...thread.messages]);
      }
      setIsBootstrapping(false);
    }

    bootstrap().catch(() => {
      if (isMounted) {
        setIsBootstrapping(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [resolvedClient]);

  async function handleSelectThread(threadId: string) {
    setSelectedThreadId(threadId);
    const thread = await resolvedClient.getMessages(threadId);
    setMessages([...thread.messages]);
  }

  async function handleCreateThread() {
    setIsCreatingThread(true);
    try {
      const created = await resolvedClient.createThread();
      const nextThread: ThreadSummary = {
        id: created.threadId,
        title: "New chat",
      };
      setThreads((current) => [nextThread, ...current]);
      setSelectedThreadId(created.threadId);
      setMessages([]);
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleSendMessage() {
    const content = composerValue.trim();
    if (!content || isSending) {
      return;
    }

    setIsSending(true);
    setComposerValue("");

    const optimisticUserMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      status: "completed",
    };

    const optimisticAssistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      status: "streaming",
    };

    setMessages((current) => [...current, optimisticUserMessage, optimisticAssistantMessage]);

    try {
      const response = await resolvedClient.sendMessage({
        threadId: selectedThreadId ?? undefined,
        content,
      });

      if (!selectedThreadId) {
        setSelectedThreadId(response.threadId);
        setThreads((current) => {
          const existing = current.find((thread) => thread.id === response.threadId);
          if (existing) {
            return current;
          }
          return [{ id: response.threadId, title: "New chat" }, ...current];
        });
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticAssistantMessage.id
            ? {
                ...message,
                id: response.assistantMessageId,
              }
            : message,
        ),
      );

      await resolvedClient.streamRun(response.runId, {
        onDelta: (delta) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === response.assistantMessageId || message.id === optimisticAssistantMessage.id
                ? {
                    ...message,
                    content: `${message.content}${delta}`,
                    status: "streaming",
                  }
                : message,
            ),
          );
        },
        onCompleted: (text) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === response.assistantMessageId || message.id === optimisticAssistantMessage.id
                ? {
                    ...message,
                    id: response.assistantMessageId,
                    content: text,
                    status: "completed",
                  }
                : message,
            ),
          );
        },
        onFailed: (error) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === response.assistantMessageId || message.id === optimisticAssistantMessage.id
                ? {
                    ...message,
                    id: response.assistantMessageId,
                    content: message.content || error,
                    status: "error",
                  }
                : message,
            ),
          );
        },
      });
    } finally {
      setIsSending(false);
    }
  }

  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-r border-border bg-sidebar text-sidebar-foreground">
          <div className="flex h-full flex-col">
            <div className="border-b border-sidebar-border px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent">
                  <PanelLeft className="size-4" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight">Pixelclaw Chat</h1>
                  <p className="text-sm text-muted-foreground">Session-aware local chat UI</p>
                </div>
              </div>
              <Button
                className="mt-4 w-full justify-start gap-2"
                onClick={handleCreateThread}
                disabled={isCreatingThread}
                variant="secondary"
              >
                <MessageSquarePlus className="size-4" />
                {isCreatingThread ? "Creating chat..." : "New Chat"}
              </Button>
            </div>

            <ScrollArea className="flex-1 px-3 py-3">
              <div className="space-y-1">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={cn(
                      "flex w-full flex-col rounded-xl border px-3 py-3 text-left transition-colors",
                      selectedThreadId === thread.id
                        ? "border-sidebar-ring bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "border-transparent bg-sidebar hover:border-sidebar-border hover:bg-sidebar-accent",
                    )}
                    onClick={() => {
                      void handleSelectThread(thread.id);
                    }}
                  >
                    <span className="text-sm font-medium">{thread.title}</span>
                    <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {selectedThreadId === thread.id ? "Current chat" : "Open transcript"}
                    </span>
                  </button>
                ))}

                {!threads.length && !isBootstrapping ? (
                  <div className="rounded-xl border border-dashed border-sidebar-border px-4 py-6 text-sm text-muted-foreground">
                    No chats yet. Start one from the button above.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </aside>

        <main className="flex min-h-screen flex-col">
          <header className="border-b border-border bg-background/90 px-6 py-4 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {selectedThread?.title ?? "Start a new conversation"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedThreadId ? "Streaming assistant replies from Fastify SSE" : "Pick a session or create one"}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                {selectedThreadId ? "Session active" : "No session selected"}
              </span>
            </div>
          </header>

          <ScrollArea className="flex-1 px-6 py-6">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {isBootstrapping ? (
                <Card className="flex items-center gap-3 px-4 py-4 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading chats...
                </Card>
              ) : null}

              {!isBootstrapping && !messages.length ? (
                <Card className="px-6 py-8 text-center">
                  <h3 className="text-base font-semibold tracking-tight">Ready to test the chat flow</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Send a message to create a run, then stream the assistant reply into this thread.
                  </p>
                </Card>
              ) : null}

              {messages.map((message) => (
                <article
                  key={message.id}
                  className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  <Card
                    className={cn(
                      "max-w-[85%] px-4 py-3",
                      message.role === "user"
                        ? "border-primary/20 bg-primary/8"
                        : "bg-card",
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {message.role === "user" ? "You" : "Assistant"}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
                          message.status === "completed" && "bg-secondary text-secondary-foreground",
                          message.status === "streaming" && "bg-accent text-accent-foreground",
                          message.status === "error" && "bg-destructive/15 text-destructive",
                          message.status === "pending" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {message.status}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.content || (message.status === "streaming" ? "Streaming..." : "")}
                    </p>
                  </Card>
                </article>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t border-border bg-background px-6 py-4">
            <div className="mx-auto flex w-full max-w-4xl gap-3">
              <Textarea
                aria-label="Message composer"
                className="min-h-24 flex-1 resize-none"
                placeholder="Ask Pixelclaw to inspect the repo, debug something, or draft the next change..."
                value={composerValue}
                onChange={(event) => {
                  setComposerValue(event.target.value);
                }}
              />
              <Button
                className="h-auto min-w-32 self-end"
                onClick={() => {
                  void handleSendMessage();
                }}
                disabled={isSending || !composerValue.trim()}
              >
                <SendHorizontal className="size-4" />
                {isSending ? "Sending..." : "Send Message"}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

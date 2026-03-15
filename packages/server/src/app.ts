import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { compactionEngine, type CompactionEngine } from "./compactionEngine.js";
import { SESSION_COOKIE } from "./constants.js";
import { createDatabase } from "./database.js";
import { runDefaultAgentTurn, type RunAgentOptions, type ServerAgentMessage } from "./defaultAgentRunner.js";
import { ChatRepository } from "./repository.js";
import { startTelegramBot } from "./telegramBot.js";

export interface BuildServerOptions {
  agentRunner?: (options: RunAgentOptions) => Promise<{ text: string }>;
  databasePath?: string;
  compactionEngine?: CompactionEngine;
  telegramBotStarter?: (options: {
    repository: ChatRepository;
    agentRunner: (options: RunAgentOptions) => Promise<{ text: string }>;
    compactionEngine: CompactionEngine;
  }) => Promise<{ close: () => Promise<void> } | null>;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify();
  const database = createDatabase(options.databasePath);
  const repository = new ChatRepository(database.daos);
  const agentRunner = options.agentRunner ?? runDefaultAgentTurn;
  const resolvedCompactionEngine = options.compactionEngine ?? compactionEngine;
  const telegramBot = await (options.telegramBotStarter ?? startTelegramBot)({
    repository,
    agentRunner,
    compactionEngine: resolvedCompactionEngine,
  });

  await app.register(cookie);

  app.addHook("onClose", async () => {
    await telegramBot?.close();
    database.sqlite.close();
  });

  app.post("/api/chat/threads", async (request, reply) => {
    const session = await ensureSession(request, reply, repository);
    const thread = await repository.createThread(session.id);
    reply.code(201);
    return {
      threadId: thread.id,
    };
  });

  app.get("/api/chat/threads", async (request, reply) => {
    const session = await ensureSession(request, reply, repository);
    const sessionThreads = await repository.listThreadsForSession(session.id);

    return {
      threads: sessionThreads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      })),
    };
  });

  app.get("/api/chat/threads/:threadId/messages", async (request, reply) => {
    const session = await ensureSession(request, reply, repository);
    const params = request.params as { threadId: string };
    const thread = await repository.getThreadForSession(params.threadId, session.id);

    if (!thread) {
      reply.code(404);
      return { error: "Thread not found" };
    }

    const threadMessages = await repository.listMessages(thread.id);
    return {
      threadId: thread.id,
      messages: threadMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
      })),
    };
  });

  app.post("/api/chat/messages", async (request, reply) => {
    const session = await ensureSession(request, reply, repository);
    const body = request.body as { content?: string; threadId?: string };
    const content = body.content?.trim();

    if (!content) {
      reply.code(400);
      return { error: "content is required" };
    }

    const thread = body.threadId
      ? await repository.getThreadForSession(body.threadId, session.id)
      : await repository.createThread(session.id);

    if (!thread) {
      reply.code(404);
      return { error: "Thread not found" };
    }

    const prepared = await resolvedCompactionEngine.prepareConversation({
      repository,
      session,
      thread,
      pendingUserMessage: content,
    });

    if (prepared.session.id !== session.id) {
      setSessionCookie(reply, prepared.session.id);
    }

    const userMessage = await repository.createMessage({
      threadId: prepared.thread.id,
      role: "user",
      content,
      status: "completed",
    });
    const assistantMessage = await repository.createMessage({
      threadId: prepared.thread.id,
      role: "assistant",
      content: "",
      status: "pending",
    });
    const run = await repository.createRun({
      threadId: prepared.thread.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      source: "web",
    });
    await repository.createRunEvent({
      runId: run.id,
      threadId: prepared.thread.id,
      sessionId: prepared.session.id,
      source: "web",
      type: "run.created",
      payload: {
        assistantMessageId: assistantMessage.id,
        userMessageId: userMessage.id,
      },
    });

    reply.code(201);
    return {
      threadId: prepared.thread.id,
      runId: run.id,
      assistantMessageId: assistantMessage.id,
      userMessageId: userMessage.id,
    };
  });

  app.get("/api/chat/runs/:runId/stream", async (request, reply) => {
    const session = await ensureSession(request, reply, repository);
    const params = request.params as { runId: string };
    const context = await repository.getThreadMessagesForRun(params.runId, session.id);

    if (!context) {
      reply.code(404);
      return { error: "Run not found" };
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    await repository.updateRun(context.run.id, {
      status: "streaming",
      startedAt: new Date().toISOString(),
      error: null,
    });
    await repository.updateMessage(context.run.assistantMessageId, {
      status: "streaming",
      content: "",
    });

    let assistantText = "";
    let hasCompletedEvent = false;
    let hasFailedEvent = false;
    let eventChain = Promise.resolve();

    const writeEvent = (event: string, data: Record<string, string> = {}) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const serializeEventData = (event: Exclude<Parameters<RunAgentOptions["onEvent"]>[0], undefined>) => {
      const entries = Object.entries(event)
        .filter(([key]) => key !== "type")
        .map<[string, string]>(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]);

      return Object.fromEntries(entries);
    };
    const extractEventPayload = (event: Exclude<Parameters<RunAgentOptions["onEvent"]>[0], undefined>) =>
      Object.fromEntries(Object.entries(event).filter(([key]) => key !== "type"));

    try {
      await agentRunner({
        sessionId: session.id,
        threadId: context.thread.id,
        messages: context.messages
          .filter((message) => message.id !== context.run.assistantMessageId)
          .filter((message) => message.role === "user" || message.status === "completed")
          .map<ServerAgentMessage>((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
            createdAt: message.createdAt,
          })),
        onEvent: (event) => {
          eventChain = eventChain.then(async () => {
            if (event.type === "run.started") {
              await repository.createRunEvent({
                runId: context.run.id,
                threadId: context.thread.id,
                sessionId: session.id,
                source: "web",
                type: event.type,
              });
              writeEvent(event.type);
              return;
            }

            if (event.type === "message.delta") {
              assistantText += event.delta;
              await repository.updateMessage(context.run.assistantMessageId, {
                content: assistantText,
                status: "streaming",
              });
              await repository.createRunEvent({
                runId: context.run.id,
                threadId: context.thread.id,
                sessionId: session.id,
                source: "web",
                type: event.type,
                payload: { delta: event.delta },
              });
              writeEvent(event.type, { delta: event.delta });
              return;
            }

            if (event.type === "message.replaced") {
              assistantText = event.text;
              await repository.updateMessage(context.run.assistantMessageId, {
                content: assistantText,
                status: "streaming",
              });
              await repository.createRunEvent({
                runId: context.run.id,
                threadId: context.thread.id,
                sessionId: session.id,
                source: "web",
                type: event.type,
                payload: { text: assistantText },
              });
              writeEvent(event.type, { text: assistantText });
              return;
            }

            if (event.type === "message.completed") {
              hasCompletedEvent = true;
              assistantText = event.text;
              await repository.updateMessage(context.run.assistantMessageId, {
                content: assistantText,
                status: "completed",
              });
              await repository.updateRun(context.run.id, {
                status: "completed",
                finishedAt: new Date().toISOString(),
                error: null,
              });
              await repository.createRunEvent({
                runId: context.run.id,
                threadId: context.thread.id,
                sessionId: session.id,
                source: "web",
                type: event.type,
                payload: { text: assistantText },
              });
              writeEvent(event.type, { text: assistantText });
              return;
            }

            if (event.type !== "run.failed") {
              await repository.createRunEvent({
                runId: context.run.id,
                threadId: context.thread.id,
                sessionId: session.id,
                source: "web",
                type: event.type,
                payload: extractEventPayload(event),
              });
              writeEvent(event.type, serializeEventData(event));
              return;
            }

            await repository.updateMessage(context.run.assistantMessageId, {
              content: assistantText,
              status: "error",
            });
            await repository.updateRun(context.run.id, {
              status: "failed",
              finishedAt: new Date().toISOString(),
              error: event.error,
            });
            hasFailedEvent = true;
            await repository.createRunEvent({
              runId: context.run.id,
              threadId: context.thread.id,
              sessionId: session.id,
              source: "web",
              type: event.type,
              payload: { error: event.error },
            });
            writeEvent(event.type, { error: event.error });
          });
          return eventChain;
        },
      });
      await eventChain;

      if (!hasCompletedEvent && !hasFailedEvent) {
        await repository.updateMessage(context.run.assistantMessageId, {
          content: assistantText,
          status: "completed",
        });
        await repository.updateRun(context.run.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
          error: null,
        });
        await repository.createRunEvent({
          runId: context.run.id,
          threadId: context.thread.id,
          sessionId: session.id,
          source: "web",
          type: "message.completed",
          payload: { text: assistantText },
        });
        writeEvent("message.completed", { text: assistantText });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await repository.updateMessage(context.run.assistantMessageId, {
        content: assistantText,
        status: "error",
      });
      await repository.updateRun(context.run.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: message,
      });
      await repository.createRunEvent({
        runId: context.run.id,
        threadId: context.thread.id,
        sessionId: session.id,
        source: "web",
        type: "run.failed",
        payload: { error: message },
      });
      writeEvent("run.failed", { error: message });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/api/admin/overview", async () => repository.getAdminOverview());

  app.get("/api/admin/runs", async () => ({
    runs: await repository.listAdminRuns(),
  }));

  app.get("/api/admin/runs/:runId", async (request, reply) => {
    const params = request.params as { runId: string };

    try {
      return await repository.getAdminRun(params.runId);
    } catch (error: unknown) {
      reply.code(404);
      return { error: error instanceof Error ? error.message : "Run not found" };
    }
  });

  app.get("/api/admin/runs/:runId/events", async (request, reply) => {
    const params = request.params as { runId: string };
    const run = await repository.getAdminRun(params.runId).catch(() => null);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const events = await repository.listRunEvents(params.runId);
    return {
      events: events.map((event) => ({
        id: event.id,
        runId: event.runId,
        threadId: event.threadId,
        sessionId: event.sessionId,
        source: event.source,
        type: event.type,
        payload: event.parsedPayload,
        createdAt: event.createdAt,
      })),
    };
  });

  return app;
}

async function ensureSession(
  request: { cookies: Record<string, string | undefined> },
  reply: { setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown },
  repository: ChatRepository,
) {
  const existingSessionId = request.cookies[SESSION_COOKIE];
  if (existingSessionId) {
    const existingSession = await repository.getSession(existingSessionId);
    if (existingSession) {
      return existingSession;
    }
  }

  const session = await repository.createSession(randomUUID());
  setSessionCookie(reply, session.id);
  return session;
}

function setSessionCookie(
  reply: { setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown },
  sessionId: string,
) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

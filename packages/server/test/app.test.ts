import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

function extractCookie(setCookieHeader: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (!header) {
      continue;
    }
    const [pair] = header.split(";");
    if (!pair) {
      continue;
    }
    const [cookieName, ...rest] = pair.split("=");
    if (cookieName === name) {
      return rest.join("=");
    }
  }
  return undefined;
}

describe("chat backend", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("creates an anonymous session and a new thread when posting a chat message", async () => {
    const app = await buildServer();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Hello from the browser" },
    });

    expect(response.statusCode).toBe(201);
    expect(extractCookie(response.headers["set-cookie"], "pixelclaw_session")).toBeTruthy();

    const payload = response.json();
    expect(payload.threadId).toEqual(expect.any(String));
    expect(payload.runId).toEqual(expect.any(String));
    expect(payload.assistantMessageId).toEqual(expect.any(String));

    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${payload.threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${extractCookie(response.headers["set-cookie"], "pixelclaw_session")}`,
      },
    });

    expect(transcript.statusCode).toBe(200);
    expect(transcript.json()).toMatchObject({
      threadId: payload.threadId,
      messages: [
        {
          role: "user",
          content: "Hello from the browser",
          status: "completed",
        },
        {
          id: payload.assistantMessageId,
          role: "assistant",
          content: "",
          status: "pending",
        },
      ],
    });
  });

  it("returns the persisted transcript for the current session", async () => {
    const app = await buildServer();
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Remember this thread" },
    });

    const sessionCookie = extractCookie(createResponse.headers["set-cookie"], "pixelclaw_session");
    const { threadId } = createResponse.json();

    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(transcript.statusCode).toBe(200);
    expect(transcript.json()).toMatchObject({
      threadId,
      messages: [
        { role: "user", content: "Remember this thread" },
        { role: "assistant", status: "pending" },
      ],
    });
  });

  it("lists threads for the current session", async () => {
    const app = await buildServer();
    apps.push(app);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "First thread" },
    });
    const sessionCookie = extractCookie(firstResponse.headers["set-cookie"], "pixelclaw_session");

    await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Second thread" },
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/chat/threads",
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      threads: [
        {
          title: "New chat",
        },
        {
          title: "New chat",
        },
      ],
    });
    expect(listResponse.json().threads).toHaveLength(2);
  });

  it("streams assistant output and persists the completed assistant message", async () => {
    const app = await buildServer({
      agentRunner: async ({ onEvent }) => {
        onEvent({ type: "run.started" });
        onEvent({ type: "message.delta", delta: "Hello" });
        onEvent({ type: "message.delta", delta: " world" });
        onEvent({ type: "message.completed", text: "Hello world" });
        return { text: "Hello world" };
      },
    });
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Stream back to me" },
    });

    const sessionCookie = extractCookie(createResponse.headers["set-cookie"], "pixelclaw_session");
    const { threadId, runId } = createResponse.json();

    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/chat/runs/${runId}/stream`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("text/event-stream");
    expect(streamResponse.body).toContain("event: run.started");
    expect(streamResponse.body).toContain('data: {"delta":"Hello"}');
    expect(streamResponse.body).toContain('data: {"delta":" world"}');
    expect(streamResponse.body).toContain('data: {"text":"Hello world"}');

    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(transcript.json()).toMatchObject({
      threadId,
      messages: [
        { role: "user", content: "Stream back to me", status: "completed" },
        { role: "assistant", content: "Hello world", status: "completed" },
      ],
    });
  });
});

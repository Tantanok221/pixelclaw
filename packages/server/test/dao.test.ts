import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { ChatRepository } from "../src/repository.js";

describe("database access objects", () => {
  it("exposes DAO helpers that can back the chat repository", async () => {
    const database = createDatabase();

    expect(database.daos.sessions.findById).toBeTypeOf("function");
    expect(database.daos.threads.insert).toBeTypeOf("function");
    expect(database.daos.runs.insert).toBeTypeOf("function");

    const repository = new ChatRepository(database.daos);
    const session = await repository.createSession("00000000-0000-4000-8000-000000000111");

    await expect(database.daos.sessions.findById(session.id)).resolves.toMatchObject({
      id: session.id,
    });

    database.sqlite.close();
  });
});

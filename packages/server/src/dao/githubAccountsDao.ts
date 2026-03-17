import { and, desc, eq } from "drizzle-orm";
import { githubAccounts, type GithubAccountRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class GithubAccountsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: GithubAccountRow): Promise<void> {
    await this.db.insert(githubAccounts).values(values);
  }

  async findById(id: string): Promise<GithubAccountRow | undefined> {
    return this.db.query.githubAccounts.findFirst({
      where: eq(githubAccounts.id, id),
    });
  }

  async findByProviderUserId(providerUserId: string): Promise<GithubAccountRow | undefined> {
    return this.db.query.githubAccounts.findFirst({
      where: eq(githubAccounts.providerUserId, providerUserId),
    });
  }

  async findByHostnameAndLogin(hostname: string, login: string): Promise<GithubAccountRow | undefined> {
    return this.db.query.githubAccounts.findFirst({
      where: and(eq(githubAccounts.hostname, hostname), eq(githubAccounts.login, login)),
    });
  }

  async listAll(): Promise<GithubAccountRow[]> {
    return this.db.query.githubAccounts.findMany({
      orderBy: [desc(githubAccounts.updatedAt), desc(githubAccounts.createdAt)],
    });
  }

  async updateById(id: string, patch: Partial<GithubAccountRow>): Promise<void> {
    await this.db.update(githubAccounts).set(patch).where(eq(githubAccounts.id, id));
  }
}

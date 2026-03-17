import { useEffect, useState } from "react";
import { Github, RadioTower } from "lucide-react";
import { formatDateTime } from "../../helpers/monitor-format.js";
import type {
  GithubAccount,
  GithubRepositorySummary,
  MonitorSummary,
} from "../../lib/monitor-client.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";

interface MonitorConfigurationPanelProps {
  githubAccounts: GithubAccount[];
  monitors: MonitorSummary[];
  onCreateMonitor: (input: {
    githubAccountId: string;
    repository: string;
  }) => Promise<unknown>;
  onListGithubRepositories: (githubAccountId: string) => Promise<GithubRepositorySummary[]>;
  onSyncGithubAccounts: () => Promise<unknown>;
}

export function MonitorConfigurationPanel({
  githubAccounts,
  monitors,
  onCreateMonitor,
  onListGithubRepositories,
  onSyncGithubAccounts,
}: MonitorConfigurationPanelProps) {
  const [githubAccountId, setGithubAccountId] = useState(githubAccounts[0]?.id ?? "");
  const [repositories, setRepositories] = useState<GithubRepositorySummary[]>([]);
  const [repository, setRepository] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isSyncingAccounts, setIsSyncingAccounts] = useState(false);

  useEffect(() => {
    if (!githubAccountId && githubAccounts[0]?.id) {
      setGithubAccountId(githubAccounts[0].id);
    }
  }, [githubAccountId, githubAccounts]);

  useEffect(() => {
    if (!githubAccountId) {
      setRepositories([]);
      setRepository("");
      setIsLoadingRepositories(false);
      return;
    }

    let cancelled = false;
    setIsLoadingRepositories(true);

    void onListGithubRepositories(githubAccountId)
      .then((nextRepositories) => {
        if (cancelled) {
          return;
        }

        setRepositories(nextRepositories);
        setRepository((current) =>
          nextRepositories.some((item) => item.fullName === current)
            ? current
            : nextRepositories[0]?.fullName ?? "",
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setRepositories([]);
        setRepository("");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRepositories(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [githubAccountId, onListGithubRepositories]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Card className="rounded-3xl border border-border bg-card shadow-none">
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Connections</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight">Connected accounts</h3>
            </div>

            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={isSyncingAccounts}
              onClick={() => {
                setIsSyncingAccounts(true);
                void onSyncGithubAccounts().finally(() => {
                  setIsSyncingAccounts(false);
                });
              }}
            >
              <Github className="size-4" />
              {isSyncingAccounts ? "Syncing..." : "Sync gh accounts"}
            </Button>
          </div>
        </div>

        <div className="space-y-3 px-6 py-5">
          {!githubAccounts.length ? (
            <div className="space-y-2 text-sm leading-6 text-muted-foreground">
              <p>No GitHub accounts are available yet.</p>
              <p>Run `gh auth login --web --scopes read:org,repo`, then sync accounts here.</p>
            </div>
          ) : (
            githubAccounts.map((account) => (
              <div
                key={account.id}
                className="rounded-2xl border border-border bg-background px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">@{account.login}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {account.displayName ?? "GitHub account"} · {account.hostname}
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                    {account.tokenSource}
                  </span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Scopes {account.scopes.join(", ") || "none"}
                </p>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="rounded-3xl border border-border bg-card shadow-none">
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Monitors</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight">GitHub PR watchlist</h3>
            </div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <RadioTower className="size-3.5" />
              <span>{monitors.length} total</span>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!githubAccountId || !repository) {
                return;
              }

              setIsCreating(true);
              void onCreateMonitor({
                githubAccountId,
                repository,
              }).finally(() => {
                setIsCreating(false);
              });
            }}
          >
            <label className="space-y-2 text-sm">
              <span className="font-medium">GitHub account</span>
              <select
                aria-label="GitHub account"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                value={githubAccountId}
                onChange={(event) => {
                  setGithubAccountId(event.target.value);
                }}
                disabled={!githubAccounts.length}
              >
                {githubAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    @{account.login}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium">Repository</span>
              <select
                aria-label="Repository"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                value={repository}
                onChange={(event) => {
                  setRepository(event.target.value);
                }}
                disabled={!githubAccounts.length || isLoadingRepositories || !repositories.length}
              >
                {!repositories.length ? (
                  <option value="">
                    {isLoadingRepositories ? "Loading repositories..." : "No repositories available"}
                  </option>
                ) : null}

                {repositories.map((item) => (
                  <option key={item.fullName} value={item.fullName}>
                    {item.fullName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                New monitors use a default name based on the selected repository.
              </p>
            </label>

            <div className="md:col-span-2">
              <Button
                type="submit"
                disabled={!githubAccounts.length || !repository || isCreating || isLoadingRepositories}
              >
                {isCreating ? "Creating..." : "Create monitor"}
              </Button>
            </div>
          </form>

          <div className="space-y-3">
            {monitors.map((monitor) => (
              <div
                key={monitor.id}
                className="rounded-2xl border border-border bg-background px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{monitor.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {monitor.owner}/{monitor.repo}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                      {monitor.status}
                    </span>
                    <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                      {monitor.unreadCount} unread
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Last poll {monitor.lastPolledAt ? formatDateTime(monitor.lastPolledAt) : "pending"}
                </p>
              </div>
            ))}

            {!monitors.length ? (
              <p className="text-sm leading-6 text-muted-foreground">
                No monitors yet. Create one to watch your authored PRs in a repository.
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

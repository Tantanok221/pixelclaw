export interface GithubViewer {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GithubRepositorySummary {
  owner: string;
  name: string;
  fullName: string;
}

export interface GithubMonitoredComment {
  id: string;
  authorLogin: string;
  body: string;
  url: string;
  createdAt: string;
}

export interface GithubMonitoredPullRequest {
  number: number;
  title: string;
  url: string;
  headSha: string;
  mergeableState: string | null;
  checksState: "passing" | "failing" | "pending";
  latestExternalComment: GithubMonitoredComment | null;
}

export interface GithubClient {
  getViewer(accessToken: string): Promise<GithubViewer>;
  listRepositories(accessToken: string): Promise<GithubRepositorySummary[]>;
  listMonitoredPullRequests(input: {
    accessToken: string;
    owner: string;
    repo: string;
    authorLogin: string;
  }): Promise<GithubMonitoredPullRequest[]>;
}

export function createGithubClient(): GithubClient {
  return {
    async getViewer(accessToken) {
      const payload = await fetchGithubJson<{
        id: number;
        login: string;
        name: string | null;
        avatar_url: string | null;
      }>("/user", accessToken);

      return {
        id: payload.id,
        login: payload.login,
        name: payload.name,
        avatarUrl: payload.avatar_url,
      };
    },

    async listRepositories(accessToken) {
      const repositories = await fetchGithubJson<
        Array<{
          owner?: { login?: string | null } | null;
          name: string;
          full_name: string;
        }>
      >(
        "/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100",
        accessToken,
      );

      return repositories
        .map((repository) => ({
          owner: repository.owner?.login ?? "",
          name: repository.name,
          fullName: repository.full_name,
        }))
        .filter((repository) => repository.owner && repository.name && repository.fullName);
    },

    async listMonitoredPullRequests(input) {
      const search = await fetchGithubJson<{
        items: Array<{ number: number }>;
      }>(
        `/search/issues?q=${encodeURIComponent(
          `repo:${input.owner}/${input.repo} is:pr state:open author:${input.authorLogin}`,
        )}&sort=updated&order=desc&per_page=25`,
        input.accessToken,
      );

      const pullRequests = await Promise.all(
        search.items.map(async (item) => loadMonitoredPullRequest(input, item.number)),
      );

      return pullRequests;
    },
  };
}

async function loadMonitoredPullRequest(
  input: {
    accessToken: string;
    owner: string;
    repo: string;
    authorLogin: string;
  },
  prNumber: number,
): Promise<GithubMonitoredPullRequest> {
  const detail = await fetchGithubJson<{
    number: number;
    title: string;
    html_url: string;
    head: { sha: string };
    mergeable_state: string | null;
  }>(`/repos/${input.owner}/${input.repo}/pulls/${prNumber}`, input.accessToken);

  const headSha = detail.head.sha;
  const [issueComments, reviewComments, reviews, checkRunsForHead, combinedStatusForHead] = await Promise.all([
    fetchGithubJson<Array<GithubCommentPayload>>(
      `/repos/${input.owner}/${input.repo}/issues/${prNumber}/comments?per_page=100`,
      input.accessToken,
    ),
    fetchGithubJson<Array<GithubCommentPayload>>(
      `/repos/${input.owner}/${input.repo}/pulls/${prNumber}/comments?per_page=100`,
      input.accessToken,
    ),
    fetchGithubJson<Array<GithubReviewPayload>>(
      `/repos/${input.owner}/${input.repo}/pulls/${prNumber}/reviews?per_page=100`,
      input.accessToken,
    ),
    fetchGithubJson<{
      check_runs: Array<{
        status: string;
        conclusion: string | null;
      }>;
    }>(`/repos/${input.owner}/${input.repo}/commits/${headSha}/check-runs?per_page=100`, input.accessToken).catch(() => ({
      check_runs: [],
    })),
    fetchGithubJson<{ state: string }>(
      `/repos/${input.owner}/${input.repo}/commits/${headSha}/status`,
      input.accessToken,
    ).catch(() => ({ state: "success" })),
  ]);

  return {
    number: detail.number,
    title: detail.title,
    url: detail.html_url,
    headSha,
    mergeableState: detail.mergeable_state,
    checksState: deriveChecksState(checkRunsForHead.check_runs, combinedStatusForHead.state),
    latestExternalComment: pickLatestExternalComment(
      input.authorLogin,
      issueComments,
      reviewComments,
      reviews,
    ),
  };
}

interface GithubCommentPayload {
  id: number;
  body: string | null;
  html_url: string;
  created_at: string;
  user?: { login?: string | null } | null;
}

interface GithubReviewPayload {
  id: number;
  body: string | null;
  html_url: string;
  submitted_at: string | null;
  user?: { login?: string | null } | null;
}

function pickLatestExternalComment(
  authorLogin: string,
  issueComments: GithubCommentPayload[],
  reviewComments: GithubCommentPayload[],
  reviews: GithubReviewPayload[],
): GithubMonitoredComment | null {
  const normalized = [
    ...issueComments.map(normalizeComment),
    ...reviewComments.map(normalizeComment),
    ...reviews.map(normalizeReview).filter((item): item is GithubMonitoredComment => item !== null),
  ]
    .filter((comment) => comment.authorLogin && comment.authorLogin !== authorLogin)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return normalized[0] ?? null;
}

function normalizeComment(comment: GithubCommentPayload): GithubMonitoredComment {
  return {
    id: String(comment.id),
    authorLogin: comment.user?.login ?? "",
    body: comment.body ?? "",
    url: comment.html_url,
    createdAt: comment.created_at,
  };
}

function normalizeReview(review: GithubReviewPayload): GithubMonitoredComment | null {
  if (!review.body?.trim() || !review.submitted_at) {
    return null;
  }

  return {
    id: String(review.id),
    authorLogin: review.user?.login ?? "",
    body: review.body,
    url: review.html_url,
    createdAt: review.submitted_at,
  };
}

function deriveChecksState(
  checkRuns: Array<{ status: string; conclusion: string | null }>,
  combinedStatus: string,
): "passing" | "failing" | "pending" {
  const failingConclusions = new Set([
    "action_required",
    "cancelled",
    "failure",
    "stale",
    "startup_failure",
    "timed_out",
  ]);

  if (combinedStatus === "failure" || combinedStatus === "error") {
    return "failing";
  }

  if (checkRuns.some((run) => run.conclusion && failingConclusions.has(run.conclusion))) {
    return "failing";
  }

  if (combinedStatus === "pending" || checkRuns.some((run) => run.status !== "completed")) {
    return "pending";
  }

  return "passing";
}

async function fetchGithubJson<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "pixelclaw",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

# GitHub PR Monitor Design

Date: 2026-03-09

## Goal

Add a GitHub monitor system to the `web` package and `server` package so a user can connect one or more GitHub accounts, create monitors for specific repositories, and receive notifications for changes on pull requests they authored.

## Product Decisions

- V1 uses GitHub OAuth, not a GitHub App.
- A user can connect multiple GitHub accounts.
- Each monitor is bound to exactly one connected GitHub account and one repository.
- A monitor only watches pull requests authored by that connected account.
- V1 notifies on:
  - new PR comments
  - failed checks or pipelines
  - merge conflicts
- The system runs only on a local long-lived server process.
- V1 uses background polling in `packages/server`; no webhook or queue system is required.

## Architecture

The monitor system lives primarily in `packages/server` with a thin configuration and notification surface in `packages/web`.

Core runtime pieces:

1. GitHub connection store
   - Persists OAuth identity metadata and token material for each connected GitHub account.

2. Monitor store
   - Persists monitor configuration, polling cadence, latest cursor state, and health metadata.

3. GitHub polling coordinator
   - Starts on server boot.
   - Loads active monitors.
   - Polls due monitors on a fixed heartbeat.
   - Prevents overlapping polls for the same monitor.
   - Applies retry backoff when GitHub returns transient errors or rate-limit responses.

4. Event normalizer
   - Compares fresh GitHub state against the stored snapshot for each PR.
   - Emits normalized events only when meaningful transitions occur.

5. Notification surface
   - Exposes unread monitor notifications to `packages/web`.
   - Powers status bar items and a simple inbox view.

This should follow the same operational pattern as the existing Telegram poller: a single in-process loop with clean shutdown handling.

## Data Model

The existing `runs` and `run_events` tables should remain focused on agent execution. External monitor activity should use first-class tables.

Suggested tables:

- `github_accounts`
  - `id`
  - `provider_user_id`
  - `login`
  - `display_name`
  - `avatar_url`
  - `access_token`
  - `scopes`
  - `created_at`
  - `updated_at`

- `monitors`
  - `id`
  - `provider` with value `github`
  - `github_account_id`
  - `owner`
  - `repo`
  - `name`
  - `status` with values such as `active`, `paused`, `error`
  - `poll_interval_seconds`
  - `next_poll_at`
  - `last_polled_at`
  - `last_error`
  - `created_at`
  - `updated_at`

- `monitor_pr_snapshots`
  - `id`
  - `monitor_id`
  - `pr_number`
  - `pr_node_id`
  - `head_sha`
  - `state`
  - `mergeable_state`
  - `last_comment_cursor`
  - `last_review_cursor`
  - `last_check_state`
  - `snapshot_hash`
  - `updated_at`

- `monitor_events`
  - `id`
  - `monitor_id`
  - `provider`
  - `type`
  - `title`
  - `payload`
  - `source_key`
  - `created_at`

- `monitor_notifications`
  - `id`
  - `monitor_event_id`
  - `status` with values such as `unread`, `read`, `archived`
  - `created_at`
  - `read_at`

`source_key` should provide a stable dedupe key such as `github:owner/repo:pr-42:checks_failed:sha`.

## Polling Model

The server runs one GitHub polling coordinator on boot.

Recommended V1 behavior:

- global heartbeat every 15 seconds
- per-monitor poll interval default of 45 seconds
- small random jitter to avoid bursty polling
- max concurrency cap across monitors
- no in-memory reliance for correctness; all cursors and snapshots persist in SQLite

Per poll:

1. Load the monitor and bound GitHub account.
2. Query authored open PRs for `owner/repo`.
3. For each PR, fetch the minimum extra data needed to derive:
   - latest regular comments
   - latest review comments or review submissions
   - current mergeability state
   - current check or workflow status for the head SHA
4. Compare the derived state to `monitor_pr_snapshots`.
5. Emit `monitor_events` for transitions:
   - `comment.created`
   - `checks.failed`
   - `checks.recovered`
   - `merge_conflict.detected`
   - `merge_conflict.resolved`
6. Create unread `monitor_notifications` for user-visible events.
7. Update the snapshot and next poll time.

V1 can ignore closed PR history and focus on open authored PRs. Closed or merged PRs can be pruned from snapshots when they disappear from the authored-open set.

## GitHub API Strategy

The polling implementation should optimize for correctness first and rate usage second.

Recommended approach:

- List authored PRs for the repo using GitHub search or repo PR listing plus author filtering.
- Fetch PR detail for mergeability when needed.
- Read issue comments for discussion changes.
- Read pull request review comments and review submissions for review activity.
- Read check runs or workflow state for the current head SHA.
- Use conditional requests where practical to reduce unnecessary payloads.

The server should normalize all raw GitHub responses into a compact internal shape before diffing.

## API Shape

The web app needs a monitor-specific API surface separate from the existing admin run endpoints.

Suggested endpoints:

- `GET /api/monitor/github/accounts`
- `POST /api/monitor/github/oauth/start`
- `GET /api/monitor/github/oauth/callback`
- `POST /api/monitor/github/accounts/:accountId/refresh`
- `GET /api/monitors`
- `POST /api/monitors`
- `PATCH /api/monitors/:monitorId`
- `GET /api/notifications`
- `POST /api/notifications/:notificationId/read`

V1 can keep these endpoints local-only and session-light if the whole app is effectively a single-user desktop or local server setup.

## Web UX

The `web` package should add three focused surfaces:

1. Connections
   - list connected GitHub accounts
   - add another GitHub account
   - remove or reconnect an account

2. Monitors
   - create a monitor from account + `owner/repo`
   - show monitor health, last poll time, and unread count
   - allow pause or resume

3. Status bar and inbox
   - show unread event chips in the status bar
   - open a detail panel for the underlying PR event
   - reserve space for future agent actions such as conflict resolution or fixing failing checks

Notification copy should be actionable and compact, for example:

- `owner/repo: checks failed on PR #42`
- `owner/repo: new comment on PR #42`
- `owner/repo: PR #42 has merge conflicts`

## Error Handling

- Invalid or revoked GitHub tokens should put the affected monitor into `error` state with a reconnect prompt.
- Poll failures should not crash the server; they should record `last_error` and retry later.
- One failing monitor must not block other monitors.
- Duplicate events should be suppressed with the stored snapshot and `source_key`.
- Shutdown should stop new polls and allow in-flight polls to finish or abort cleanly.

## Testing

Server tests:

- OAuth connection persistence and callback handling
- monitor CRUD and validation
- polling coordinator scheduling behavior
- event diffing for comments, checks, and merge conflicts
- dedupe behavior across repeated polls
- backoff behavior on transient GitHub failures

Web tests:

- connected account listing and monitor creation flow
- unread notification rendering in the status bar
- inbox detail state for comment, check failure, and conflict events

## Rollout

1. Add schema and repository support for GitHub accounts, monitors, snapshots, events, and notifications.
2. Add GitHub OAuth flow and account management endpoints.
3. Add the polling coordinator with deterministic snapshot diffing.
4. Add notification endpoints and status bar rendering in `web`.
5. Add monitor creation and management UI.
6. Add placeholder agent action affordances without implementing the actions yet.

## Implementation Breakdown

Phase 1: server foundation

- schema migration for new monitor tables
- DAO and repository methods
- GitHub API client wrapper
- OAuth token persistence

Phase 2: polling runtime

- polling coordinator
- authored PR fetchers
- snapshot diff engine
- event and notification creation

Phase 3: web product surface

- GitHub connection flow
- monitor creation UI
- notifications in status bar
- monitor management list

Phase 4: hardening

- rate-limit handling
- reconnect UX for expired tokens
- better event copy
- test coverage for noisy edge cases

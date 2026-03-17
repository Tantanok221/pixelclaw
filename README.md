# Pixelclaw

Turborepo workspace for the Pixelclaw chat app and agent runtime.

## Requirements

- Node.js `>=20` (Node `22+` recommended)

## Setup

```bash
npm install
cp .env.example .env
```

The web app talks to the Fastify backend in `packages/server`, and the backend invokes the agent runtime in `packages/agent`.

## GitHub PR Monitor

GitHub monitor support is optional and uses the locally authenticated GitHub CLI instead of a custom OAuth app.

Before opening the monitor dashboard, authenticate the machine with:

```bash
gh auth login --web --scopes read:org,repo
```

Then sync accounts from the dashboard, or call:

```text
POST /api/monitor/github/accounts/sync
```

After syncing an account, create a monitor for a repository. The server polls for authored PR changes and pushes unread notifications to the browser over SSE.

## Telegram Bot

Telegram support is optional and is enabled when Pixelclaw can read a bot token from:

```text
$PIXELCLAW_HOME/system/telegram.json
~/.pixelclaw/system/telegram.json
```

Example config:

```json
{
  "botToken": "123456:example"
}
```

When configured, the server starts a Telegram long-polling bot on boot. Each Telegram chat is treated as a personal inbox with one active session. Send `/new` in Telegram to start a fresh session.

Telegram access is gated per Telegram user. The first message from an unpaired user returns a short-lived local pairing command. Run that command on the machine hosting Pixelclaw to authorize that Telegram user across all of their chats and devices:

```bash
npm run pair:telegram -- <pairing-code>
```

## Agent Auth

Pixelclaw stores agent OAuth credentials in:

```text
$PIXELCLAW_HOME/system/auth.json
~/.pixelclaw/system/auth.json
```

To log the agent runtime into OpenAI Codex and save the credentials there, run:

```bash
npm run auth:agent
```

## Scripts

```bash
npm run auth:agent
npm run dev

npm run dev:web
npm run dev:server
npm run dev:agent -- "Say hi from pixelbot"

npm run build
npm run start

npm run test
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run osfmt
```

`npm run dev:server` now runs the backend in watch mode, so changes under `packages/server/src` restart the Fastify process automatically.

## Workspace Layout

```text
packages/
  agent/    Shared Pixelbot agent runtime
  cli/      Admin CLI commands
  server/   Fastify + SQLite chat backend
  web/      React + Tailwind + shadcn-style chat frontend
```

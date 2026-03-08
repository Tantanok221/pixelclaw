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

## Scripts

```bash
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

## Workspace Layout

```text
packages/
  agent/    Shared Pixelbot agent runtime
  cli/      Admin CLI commands
  server/   Fastify + SQLite chat backend
  web/      React + Tailwind + shadcn-style chat frontend
```

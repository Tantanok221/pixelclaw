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
  server/   Fastify + SQLite chat backend
  web/      React + Tailwind + shadcn-style chat frontend
```

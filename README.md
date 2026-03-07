# Pixelclaw

Minimal Turborepo workspace for building agent packages with PI AI packages.

## Requirements

- Node.js `>=20` (Node `22+` recommended)

## Setup

```bash
npm install
cp .env.example .env
```

Add your `OPENAI_API_KEY` to `.env`.

## Scripts

```bash
npm run dev -- "Say hi from pixelbot"
npm run build
npm run start -- "Say hi from pixelbot"

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
  agent/    Current Pixelbot runtime and tests
```

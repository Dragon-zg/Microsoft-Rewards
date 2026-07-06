# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Microsoft Rewards automation bot written in TypeScript. It uses patchright (a patched Playwright fork) to log into Microsoft/Bing sessions, fetch Rewards dashboards and app APIs, complete daily activities, and run Bing searches for configured accounts.

README warning: V3.x may not fully support the new Bing Rewards interface. `Login.getRewardsSession()` detects the modern dashboard and disables request-token use for that session, but activity support can still vary.

## Commands

```bash
# Setup: install deps, clear dist, install Chromium for patchright
npm run pre-build

# Build / typecheck
npm run build

# Run compiled output
npm run start

# Run TypeScript directly
npm run ts-start
npm run dev              # same as ts-start with -dev; loads src/accounts.dev.json, still uses src/config.json

# Formatting and linting
npm run format
npm run format:check
npx eslint src/

# Utilities
npm run clear-diagnostics
npm run clear-sessions
npm run open-session     # opens a saved/manual browser session; expects -email handling in script
npm run open-session:dev

# Docker / Nix
npm run create-docker
docker compose up -d
bash scripts/nix/run.sh  # runs compiled app under nix develop + xvfb-run
```

There is no test runner or `npm test` script configured. Use `npm run build`, `npm run format:check`, and `npx eslint src/` as the available local verification commands.

## Runtime Configuration

- Node.js must satisfy `package.json` `engines.node` (`>=24.0.0`), enforced at startup by `checkNodeVersion()`.
- Bare-metal config files are `src/accounts.json` and `src/config.json`; copy from the `.example.json` files and rebuild after changing them.
- `src/accounts.json` is a flat account array, not an object wrapper.
- Passing `-dev` only switches accounts loading to `src/accounts.dev.json`; config loading remains `src/config.json`.
- `loadSessionData()` and save helpers resolve sessions under `../browser/<sessionPath>/<email>` relative to the compiled `util` directory, so the configured `sessionPath` is nested under the runtime browser directory.
- Docker writes generated `accounts.json` and `config.json` into `dist/config/` and symlinks them into `dist/` so compiled code can load them. `CONFIG_*` env vars override config on each container start; Docker forces headless mode.

## Code Style

- Prettier: 4 spaces, single quotes, no semicolons, no trailing commas, print width 120, LF endings, `arrowParens: avoid`.
- ESLint: `eslint:recommended` + `@typescript-eslint/recommended`, single quotes, no semicolons, Unix line endings, `prefer-arrow-callback`, `@typescript-eslint/no-explicit-any` warns.
- TypeScript is strict with `noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, and `noImplicitOverride`.
- Target is ES2020, module format is CommonJS, output goes to `dist/`.

## High-Level Architecture

### Orchestration

`MicrosoftRewardsBot` in `src/index.ts` owns the core subsystems: config/accounts loading, logger, axios client, browser factory/helpers, login flow, workers, activities, and search manager. `main()` checks the Node version, installs process-level shutdown/error handlers, initializes accounts, then runs either a single-process loop or clustered workers.

When `config.clusters > 1`, the primary process chunks accounts and forks Node `cluster` workers. Workers process their assigned accounts and send stats/log messages back through IPC; webhook queues are flushed before worker or process exit.

### Per-Account Flow

`MicrosoftRewardsBot.Main()` runs one account mostly in a mobile context:

1. Create a mobile browser context with saved cookies/fingerprint if available.
2. Run the login state machine and save session cookies.
3. Request a mobile app access token.
4. Fetch Rewards dashboard data, app dashboard data, and Bing panel flyout data.
5. Derive locale and point totals from dashboard data.
6. Run `doOtherPromotions()` unconditionally, then configured workers for app promotions, daily set, special promotions, more promotions, daily check-in, read-to-earn, and punch cards.
7. Fetch current search counters and delegate mobile/desktop searches to `SearchManager`.
8. Close browser contexts, save cookies, and report collected points.

### Async Context

`src/index.ts` uses `AsyncLocalStorage<ExecutionContext>` to carry the current account and `isMobile` flag through async call chains. Code that needs the current device mode should use `bot.isMobile`/`getCurrentContext()` rather than adding extra plumbing unless there is a clear boundary reason.

### Browser and Login

`src/browser/Browser.ts` launches patchright Chromium, applies proxy settings, injects fingerprints with `fingerprint-injector`, updates Edge user agents via `UserAgentManager`, disables WebAuthn/passkey browser features, restores cookies, and optionally persists fingerprints per account/device.

`src/browser/auth/Login.ts` is a selector-driven state machine for Microsoft login states such as email/password entry, passkey prompts, KMSI, recovery email, TOTP, passwordless login, and code-login flows. Specialized handlers live in `src/browser/auth/methods/`. Finalization verifies Bing and Rewards sessions and captures `__RequestVerificationToken` when the legacy dashboard exposes it.

`src/browser/BrowserFunc.ts` contains API/browser helper calls: Rewards dashboard with HTML fallback, panel flyout data, app/Xbox dashboard data, earnable points, search counters, current points, cookie header construction, and browser close/session persistence.

### Activities and Workers

`src/functions/Workers.ts` filters dashboard/app promotion collections according to completion, lock state, type, and configured worker toggles. It handles promotion groups such as daily set, more promotions, punch cards, special promotions, app promotions, and direct DAPI “other promotions”.

`src/functions/Activities.ts` is the activity dispatcher. API-based handlers include `Quiz`, `UrlReward`, `FindClippy`, and `DoubleSearchPoints`; browser-based handlers include `Search` and `SearchOnBing`; app-based handlers include `DailyCheckIn`, `ReadToEarn`, and `AppReward`.

### Search

`src/functions/SearchManager.ts` decides whether mobile and/or desktop searches are needed from missing point counters and worker toggles. It can run mobile and desktop searches in parallel or sequentially based on `config.searchSettings.parallelSearching`; desktop browser sessions are created only when desktop points are still available.

`src/functions/QueryEngine.ts` builds search query lists from configured sources (`google`, `wikipedia`, `reddit`, `local`), normalizes/deduplicates them, and can expand topics with Bing suggestions/related terms. Query-engine HTTP calls respect `config.proxy.queryEngine`.

### Logging, Webhooks, and Validation

`src/logging/Logger.ts` applies independent console/webhook filters with whitelist/blacklist modes using levels, keywords, and regex patterns. Discord and ntfy senders use `p-queue`; clustered workers forward webhook-relevant logs to the primary process by IPC.

`src/util/Validator.ts` defines Zod schemas for config and account files. Keep `src/interface/*.ts`, the Zod schemas, and `.example.json` files in sync when adding or changing configuration fields.

## Docker

The Dockerfile uses a Node 24 builder stage to run `npm ci`, compile TypeScript, reinstall production dependencies, and install patchright Chromium. The runtime image copies compiled `dist/`, production `node_modules`, `src/config.example.json`, cron scripts, and an entrypoint that handles timezone, account/config generation from environment variables, config drift warnings, cron setup, and scheduled execution.

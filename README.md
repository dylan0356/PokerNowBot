# PokerNow Discord Stats Tracker

Discord bot and worker stack for tracking PokerNow tables, reconstructing completed hands, and reporting player stats back in Discord.

The bot watches Discord messages for PokerNow table links, queues live tracking jobs, stores raw table events, reconciles completed hands from PokerNow logs, attributes PokerNow screen names to Discord users, and keeps cached stats for slash commands.

## Project Layout

- `apps/bot`: Discord client, message link detection, and slash commands
- `apps/tracker`: live PokerNow tracker and hand reconciliation queue producers
- `apps/workers`: background stats refresh and snapshot workers
- `apps/api`: Fastify API for stats reads
- `packages/db`: Prisma schema, migrations, and shared Prisma client
- `packages/shared`: config, logging, queue names, and shared types
- `packages/stats`: stats calculation helpers
- `tests`: Node test runner tests

## Prerequisites

- Node.js 22+
- npm
- Docker / Docker Compose
- A Discord application and bot token

## Environment

Create `.env` from the example:

```sh
cp .env.example .env
```

Required local defaults:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pokernow_tracker?schema=public"
REDIS_URL="redis://localhost:6379"
DISCORD_TOKEN=""
DISCORD_CLIENT_ID=""
DISCORD_GUILD_ID=""
```

Discord variables:

- `DISCORD_TOKEN`: bot token from the Discord Developer Portal
- `DISCORD_CLIENT_ID`: application/client id
- `DISCORD_GUILD_ID`: one dev server id for fast guild command registration
- `DISCORD_GUILD_IDS`: comma-separated server ids; overrides/extends the single-guild workflow when set

PokerNow variables usually stay at defaults:

```env
POKERNOW_BASE_URL="https://www.pokernow.com"
POKERNOW_SOCKET_URL="https://www.pokernow.com"
POKERNOW_LAYOUT="d"
POKERNOW_COOKIE_HEADER=""
POKERNOW_QUERY_PLAYER_TOKEN=""
POKERNOW_HEARTBEAT_TIMEOUT_MS="30000"
```

Optional runtime variables:

- `SENTRY_DSN`: enables Sentry reporting
- `LOG_LEVEL`: defaults to `info`
- `LOG_PRETTY`: set `true`/`false`; defaults based on TTY
- `PORT`: API port, defaults to `3000`

## Install And Database Setup

Start Postgres and Redis:

```sh
docker compose up -d
```

Install dependencies:

```sh
npm install
```

Generate Prisma Client:

```sh
npm run db:generate
```

Apply migrations:

```sh
npm run db:migrate
```

Reset the local database when you want a clean dev database:

```sh
npx prisma migrate reset --schema packages/db/prisma/schema.prisma --force
```

The Prisma schema is not in the default `./prisma/schema.prisma` path, so direct Prisma commands need:

```sh
--schema packages/db/prisma/schema.prisma
```

## Running Locally

Run the services in separate terminals:

```sh
npm run dev:bot
npm run dev:tracker
npm run dev:workers
npm run dev:api
```

Useful checks:

```sh
npm run build
npm test
docker compose ps
docker compose logs -f postgres
docker compose logs -f redis
```

Stop infrastructure:

```sh
docker compose down
```

Stop infrastructure and delete local Postgres data:

```sh
docker compose down -v
```

## Tracking Tables

1. Start `dev:bot`, `dev:tracker`, and `dev:workers`.
2. Post a PokerNow table URL in a Discord channel where the bot can read messages.
3. The bot replies with `Tracking PokerNow table <table_id>` and reacts with a check mark.
4. Use `/tracking-status` to confirm state and heartbeat.
5. Use `/players` to see aliases observed on tracked tables.

The bot stores tracking per Discord server and PokerNow table id. If a tracked table is already active, posting the same link again does not create a duplicate job.

## Importing PokerNow CSV Logs

PokerNow CSV downloads with `entry,at,order` columns can be imported directly:

```sh
npm run import:pokernow-csv -- --guild-id <discordGuildId> --table-id <pokernowTableId> --csv <path/to/poker_now_log.csv>
```

Example:

```sh
npm run import:pokernow-csv -- --guild-id 1402481562850955446 --table-id pglS-DecN6jYyfRVYhW2vcJvf --csv poker_now_log_pglS-DecN6jYyfRVYhW2vcJvf.csv
```

The importer creates or reuses the guild/table, creates an ended tracking session, stores the raw CSV rows as a raw event, parses hands through the normal PokerNow log parser, persists those hands, resolves aliases to Discord users, and refreshes stat snapshots.

## Player And Alias Model

There are two related concepts:

- Discord player: the canonical player record in one Discord server. Every player record has a Discord user id and a display name.
- PokerNow alias: the screen name that appears in PokerNow logs.

Stats are calculated for Discord players. A PokerNow alias must resolve to a Discord user before that player's hands can be attributed correctly.

PokerNow hand logs may include aliases like `michael @ Mjfl6P6jzI`. Link the normal display name, for example `michael`; the app resolves the suffixed log identity through that display-name alias.
Alias matching is case-insensitive: `Ridley`, `ridley`, and `ridley @ U-9YrwDlW3` all normalize to `ridley`.

Stats shown by `/stats` are paged by stored game type when more than one game exists. Each game page defaults to `Heads Up` and `Multiway` rows. Current rate stats are `VPIP`, `PFR`, `3Bet`, `4Bet`, `CBet`, and `Fold to CBet`. 3bet/4bet/cbet rates are calculated over observed opportunities from the parsed action sequence, not over total hands.
Use the optional `handedness` and `game_type` filters on `/stats` and `/leaderboard` to narrow to heads up, multiway, exact table size, or a specific game type. When no game type is supplied, left/right reactions page through the stored games.

If hands were imported or tracked before a Discord player/alias existed, create the player and alias later, then run:

```text
/player-recompute
```

That command backfills hand/action ownership from the current alias mappings and queues a stats refresh. Use `/player-recompute table_id:<PokerNow table id>` to limit the backfill to one table.

Alias resolution order:

1. Table-specific override for that PokerNow table.
2. Guild/server default alias owner.
3. Unresolved if neither exists.

## Common Username Assignment Workflows

Self-service link for normal users:

```text
/link-pokernow alias:<PokerNow screen name>
```

This creates or reuses the Discord user's player record and sets that PokerNow alias as theirs by default in the server.

Undo your own self-service link:

```text
/unlink-pokernow alias:<PokerNow screen name>
```

Admin/manual setup for someone else:

```text
/player-create user:<Discord user> [display_name:<Player display name>]
/player-alias-add user:<Discord user> alias:<PokerNow screen name>
/player-alias-add user:<Discord user> alias:<alias1>, <alias2>, <alias3>
```

Players are Discord users. If that Discord user does not have a player record yet, alias assignment creates one from their Discord display name.

Set or change the default owner of an alias:

```text
/player-alias-set-default alias:<PokerNow screen name> user:<Discord user>
```

Remove a server-wide alias mapping:

```text
/player-alias-remove alias:<PokerNow screen name>
```

Handle a one-table exception, for example when two different people have used the same PokerNow name on different nights:

```text
/player-override-set table_id:<PokerNow table id> alias:<PokerNow screen name> user:<Discord user>
```

Clear that one-table exception:

```text
/player-override-clear table_id:<PokerNow table id> alias:<PokerNow screen name>
```

After changing alias mappings, recompute historical attribution:

```text
/player-recompute
```

Or only recompute one PokerNow table:

```text
/player-recompute table_id:<PokerNow table id>
```

Use these commands to audit mappings:

```text
/aliases
/unresolved-aliases
/players
/players table_id:<PokerNow table id>
/player-show user:<Discord user>
```

Admin-only player commands require either Discord `Manage Server` permission or the hard-coded admin user id in `apps/bot/src/discord/commands.ts`.

## Discord Commands

User commands:

- `/link-pokernow alias:<alias>`: link your Discord user to a PokerNow alias
- `/unlink-pokernow alias:<alias>`: unlink one of your PokerNow aliases
- `/stats [user] [handedness] [game_type]`: show stats for yourself or another Discord user; pages by game type and defaults to heads up and multiway
- `/leaderboard [handedness] [game_type]`: show leaderboard; pages by game type and defaults to separate heads up and multiway sections
- `/sessions [user]`: show recent sessions
- `/graph [user]`: show cumulative profit graph URL
- `/players [table_id]`: show observed PokerNow aliases and resolved player owners
- `/tracking-status`: show tracked table state
- `/player-show user:<user>`: show a Discord user's player record
- `/aliases`: list server default alias ownership
- `/unresolved-aliases`: list aliases that do not resolve to a Discord user

Admin commands:

- `/tracking-debug`: show BullMQ queue/debug state
- `/player-create user:<user> [display_name:<name>]`: create or update a Discord player's display name
- `/player-alias-add user:<user> alias:<alias>`: assign one or more default alias owners; comma-separated aliases are supported
- `/player-alias-remove alias:<alias>`: remove default alias mapping
- `/player-alias-set-default alias:<alias> user:<user>`: set default alias owner
- `/player-override-set table_id:<id> alias:<alias> user:<user>`: set table-specific owner
- `/player-override-clear table_id:<id> alias:<alias>`: clear table-specific owner
- `/player-recompute [table_id]`: rewrite historical hand/action attribution from current mappings

## API

Start the API:

```sh
npm run dev:api
```

Read stats for a Discord user:

```sh
curl http://localhost:3000/guilds/<guildId>/players/<discordUserId>/stats
```

The endpoint returns `404` if the Discord user does not have a player record yet.

## Railway / Container Deployment

The repo includes one shared `Dockerfile`. Use the same image for each Railway service and set a different start command per service.

Create Railway services:

- Postgres plugin
- Redis plugin
- Bot service: `npm run start:bot`
- Tracker service: `npm run start:tracker`
- Workers service: `npm run start:workers`
- API service, optional: `npm run start:api`

Required Railway variables:

```env
DATABASE_URL=<Railway Postgres DATABASE_URL>
REDIS_URL=<Railway Redis REDIS_URL>
DISCORD_TOKEN=<bot token>
DISCORD_CLIENT_ID=<application id>
DISCORD_GUILD_ID=<server id>
POKERNOW_BASE_URL=https://www.pokernow.com
POKERNOW_SOCKET_URL=https://www.pokernow.com
POKERNOW_LAYOUT=d
POKERNOW_HEARTBEAT_TIMEOUT_MS=10800000
LOG_LEVEL=info
```

Optional variables:

```env
DISCORD_GUILD_IDS=<comma-separated server ids>
POKERNOW_COOKIE_HEADER=
POKERNOW_QUERY_PLAYER_TOKEN=
SENTRY_DSN=
PORT=3000
```

Run migrations once after deploys that change the Prisma schema:

```sh
npm run db:migrate:deploy
```

On Railway, run that as a one-off command or a short-lived migration service. Do not run migrations in every long-running service startup, because multiple services can contend for Prisma's migration advisory lock.

The API service listens on `0.0.0.0:$PORT`, so Railway can expose it directly. Bot, tracker, and workers are private background services and do not need public networking.

## Troubleshooting

If Prisma says it cannot find the schema, include the schema path:

```sh
npx prisma migrate dev --schema packages/db/prisma/schema.prisma
npx prisma migrate reset --schema packages/db/prisma/schema.prisma --force
```

If Prisma times out on `SELECT pg_advisory_lock(72707369)`, another Prisma migration process or stale Postgres backend is holding the migration lock. First stop any local Prisma/dev processes:

```sh
ps aux | grep -E "prisma|schema-engine|tsx"
pkill -f "prisma migrate"
```

If the lock remains, inspect and terminate stale advisory-lock backends in the local Postgres container:

```sh
docker compose exec postgres psql -U postgres -d pokernow_tracker -c "select l.pid, l.granted, a.state, a.wait_event_type, a.wait_event, age(clock_timestamp(), a.query_start) as query_age, a.query from pg_locks l join pg_stat_activity a on a.pid = l.pid where l.locktype = 'advisory';"
docker compose exec postgres psql -U postgres -d pokernow_tracker -c "select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory';"
```

Then rerun:

```sh
npx prisma migrate reset --schema packages/db/prisma/schema.prisma --force
```

If Docker Compose prints warnings like `The "..." variable is not set`, check `.env` for unescaped `$` characters, usually in cookie/token values. Compose reads `.env` and treats `$name` as variable interpolation. Escape literal dollar signs as `$$`.

## Current Boundaries

- Public PokerNow table support is the main path.
- Tracking connects to PokerNow Socket.IO and reconciles completed hands from PokerNow logs.
- Raw table events are retained permanently.
- Hand reconstruction is intended to be idempotent.
- Player attribution is guild-scoped, with optional table-specific overrides.

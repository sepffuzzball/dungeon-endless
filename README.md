# Dungeon of the Endless

Dungeon of the Endless is a persistent, single-player text dungeon built with SvelteKit, PostgreSQL, Drizzle ORM, and optional OpenAI-compatible language-model endpoints. The server owns room generation, dice, health, inventory, settlement, and achievements. Models provide bounded interpretation and flavor; deterministic fallbacks keep the game playable without a model.

Licensed third-party font attribution and immutable asset provenance are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Local setup

Requirements:

- Node.js 22 and npm
- PostgreSQL 17 (older supported PostgreSQL releases may work, but the container uses 17)

```sh
cp .env.example .env
# Fill every blank required value in .env. Generate APP_ENCRYPTION_KEY with:
# openssl rand -hex 32
npm ci
docker compose up -d db
npm run db:migrate
npm run bootstrap
npm run dev
```

Open `http://localhost:5173`. The production adapter listens on `PORT` (3000 by default); Vite's development port is normally 5173.

Useful commands:

```sh
npm run format
npm run check
npm run lint
npm test
npm run build
npm run preview
```

## Environment

| Variable                   | Purpose                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`        | Required password consumed by the Compose PostgreSQL service.                                                         |
| `DATABASE_URL`             | PostgreSQL URL used by the app, migrations, and bootstrap.                                                            |
| `APP_ENCRYPTION_KEY`       | Stable AES-256-GCM key used to encrypt stored LLM API keys. Use 64 hex characters or base64 that decodes to 32 bytes. |
| `NODE_ENV`                 | `development`, `test`, or `production`. Production also forces secure cookies.                                        |
| `PORT`                     | Adapter-node HTTP port; default 3000.                                                                                 |
| `SECURE_COOKIE`            | Forces the session cookie's Secure flag outside production when `true`.                                               |
| `BOOTSTRAP_ADMIN_USERNAME` | Required only when no administrator exists; may be removed after successful bootstrap.                                |
| `BOOTSTRAP_ADMIN_PASSWORD` | Required only when no administrator exists; must be 12 to 72 UTF-8 bytes and may then be removed.                     |
| `ALLOW_INSECURE_LLM_URLS`  | Allows plain HTTP model endpoints. Keep false outside isolated development.                                           |
| `ALLOW_PRIVATE_LLM_URLS`   | Allows private, loopback, or link-local model hosts. Keep false unless a trusted local endpoint is intentional.       |
| `LLM_MAX_TOKENS`           | Maximum tokens requested from a model.                                                                                |
| `LLM_TIMEOUT_MS`           | Model request timeout.                                                                                                |
| `LLM_MAX_RESPONSE_BYTES`   | Maximum response body read from a model.                                                                              |

`DATABASE_URL` and `APP_ENCRYPTION_KEY` are always mandatory and have no application defaults. The two bootstrap variables are required only until the first administrator is created. The encryption key must be exactly 64 hexadecimal characters or canonical base64 that decodes to exactly 32 bytes. Keep `.env`, database passwords and URLs, encryption keys, model keys, backups, and cookies out of logs and source control. If `APP_ENCRYPTION_KEY` is lost or changed, existing encrypted endpoint credentials cannot be decrypted.

## Bootstrap and roles

`npm run bootstrap` first checks for an account with role `admin`. If one exists, it succeeds without bootstrap credentials and never changes or resets that account. Otherwise, both bootstrap variables are required and the password must be 12 to 72 UTF-8 bytes. Run migrations first. After the first successful bootstrap, remove both bootstrap variables from deployment configuration.

Role-based access control is server-enforced:

- `user`: dashboard, character creation, run setup, and owned play sessions.
- `editor`: user access plus monster, trap, species, and calling content management.
- `admin`: all access plus account and LLM endpoint administration.

Administrators create accounts and can disable users or reset passwords. Disabling an account and resetting a password revoke its sessions. Run and character reads and mutations are scoped to the authenticated owner; knowing another run UUID does not grant access.

## Routes and model purposes

- `/login`: cookie-session authentication.
- `/change-password`: required password replacement for accounts marked by an administrator.
- `/`: owned-character dashboard, active runs, records, and achievements.
- `/characters`, `/characters/new`, and `/characters/[characterId]/edit`: create and edit character profiles, buy permanent progression, continue an active run, or irreversibly retire an inactive owned character.
- `/dungeon`: choose an owned character and unlocked starting room, or resume an active expedition.
- `/settings`: update the company name and future-expedition brutality/debauchery settings.
- `/play/[runId]`: view an owned active or finished run in the chronological expedition terminal. `?/act` resolves one room; `?/abandon` settles and closes an active run.
- `/play/[runId]/stream`: authenticated, owner-scoped SSE for one exact turn or room-entry narration UUID.
- `/editor`: editor/admin monster, trap, species, and calling definitions used by future rooms and characters. Existing snapshots retain their saved text.
- `/admin`: admin-only users and OpenAI-compatible endpoints.
- `/health`: process health endpoint used by the container health check.

Endpoint records have one of four purposes:

- `interpretation`: converts an action into only `approach`, optional `skill`, and advantage from -2 through 2.
- `suggestions`: returns up to three bounded actions for the current room.
- `prose`: narrates an already-resolved outcome.
- `summary`: creates a short log summary for an already-resolved outcome.

Enabled endpoints are tried in name order for their purpose. URLs and all resolved A/AAAA addresses are validated immediately before each request, redirects are not followed, reads and token counts are bounded, and failures fall through to the next endpoint. If all endpoints fail or none are configured, deterministic action heuristics, suggestions, prose, and summaries are used. Model output never controls dice, targets, rewards, health, inventory, or settlement. No model or network call occurs inside a database transaction.

Action and room-entry prose is streamed token-by-token after authoritative resolution. Pending, streaming, complete, and failed states plus accumulated prose are persisted. Producers hold a 30-second lease, renew it independently every eight seconds even while a model is silent, and condition every write on the exact claim timestamp. Followers replay only the durable saved suffix and immediately contend for an expired lease. Disconnects release a claimed record for recovery, while recovered partial output is finalized safely instead of being duplicated. Reverse proxies must not buffer `/play/*/stream` responses. The route requires `Accept: text/event-stream` plus an exact same-origin `Origin` or `Referer`, and sends `X-Accel-Buffering: no`, `Cache-Control: no-store, no-transform`, and periodic SSE keepalives. Proxy and load-balancer streaming timeouts still need suitable deployment configuration.

JavaScript-enhanced actions return durable narration IDs for streaming. Ordinary HTML form submissions use deterministic narration for the current room, resolved turn, and next room before redirecting, so gameplay remains usable without JavaScript or an available model endpoint.

## Core game rules

### Characters, progression, and expeditions

- A character profile starts with exactly one point split across Body, Mind, and Spirit, each 0 or 1. Species and calling choices are editor-managed snapshots; build and height use fixed choices, and profiles can include a 2000-character description.
- Character level and stats are permanent. Each level adds one stat point; stats are capped at 3 through level 9, while level 10 permits at most one stat at 4. Reaching levels 2 through 10 costs 20 through 100 company gold.
- Permanent company gear tiers +1 through +3 cost 25, 75, and 225 company gold. Gear is materialized into each new run as explicitly non-sellable inventory.
- Starting-room access costs 5 company gold per one-room increase, to a maximum of 1000. Starting an expedition itself is free and may use any room from 1 through that character's unlocked maximum.
- New rules-version-2 expeditions snapshot the character's level, stats, gear, starting room, and company settings. Later edits and upgrades cannot change an active run. Legacy rules-version-1 runs continue using their saved charter metadata, inventory, HP, and settings.
- Retirement is irreversible and is blocked while a character has an active expedition. Retired characters leave normal rosters and cannot be edited, upgraded, or sent on new expeditions; their completed runs and company records remain intact.
- The play loop uses `5 + run level` base defense and `Body + run level` base attack. Magic gear can add to attack, defense, a primary stat, or a skill. Primary gear bonuses are capped at +5.

### Sliders

Brutality and debauchery each range from 1 through 5 in company settings. They are copied into new runs and direct generated prose, not mechanics, rolls, or rewards.

- Brutality: soft, fair, grim, harsh, then merciless narrative treatment.
- Debauchery: chaste, suggestive, mildly explicit, explicit, then very explicit adult themes.

Character age is profile information from 1 through 999 and does not alter company settings or run access. Operators remain responsible for model configuration, moderation, and any legally required age gate.

### Rooms, checks, and rewards

- Every positive multiple of five is a boss room. Other rooms are selected with weights: monster 50, trap 20, treasure 10, and rest 10.
- A check rolls one d10. Advantage +1/+2 rolls two/three dice and keeps the highest; disadvantage -1/-2 keeps the lowest. `kept die + modifier >= target` succeeds.
- Combat uses attack against monster defense. A skill approach uses its governing primary stat and relevant gear. Trap difficulty is `5 + floor(room / 5)` and uses the trap's skill unless the action is interpreted as combat.
- A failed monster, boss, or trap check costs 1 HP. A rest room requires no check and heals 1 HP. A draught drawn as a reward heals 1 HP immediately, up to maximum HP.
- Treasure requires no check, has three generated rewards, and always yields one draw. A boss has six and yields two draws on a successful combat result. Non-draught rewards enter run inventory.
- On defeat or abandonment, inventory is settled exactly once: sellable magic items yield deterministic 1d2 gold, valuables deterministic 1d6, draughts zero, and persistent gear zero. Proceeds enter the company wallet and inventory is cleared.

The run seed, room number, turn sequence, and purpose label seed every room, check, reward, and settlement stream. Complete charter metadata and the current room are persisted at run start, including a pending initial room-entry snapshot. Each accepted action inserts one immutable pending turn at `version + 1` and, on survival, the next pending room-entry snapshot in the same transaction. An expected version rejects stale forms and a UUID action key makes retries idempotent. The run row is locked during resolution, so the browser cannot choose a roll, spend, reward, or duplicate settlement. Narration and later summaries run outside gameplay transactions and cannot change these immutable snapshots or outcomes.

Achievements are inserted and awarded idempotently for first entry, a character run's first defeat by the dungeon, reaching room 10, and accumulating 100 or 1000 company gold. Starting at room 10 or beyond records that depth and awards the corresponding achievement immediately.

### Progression migration cutover

Migration `0002` is a single-writer cutover: stop all application writers, apply the migration once, then deploy the matching application build. It atomically initializes each company wallet from the sum of its characters' legacy `persistent_gold`, reconciles character level to the existing stat total when that total is 1 through 10, validates persistent allocation constraints, and seeds wallet achievements. Legacy character gold is intentionally left unchanged and frozen for rollback/read compatibility; it is no longer authoritative and the application never reads or writes it for economy operations.

## Docker Compose

For a local all-in-one deployment:

```sh
export APP_ENCRYPTION_KEY='<strong stable key>'
export BOOTSTRAP_ADMIN_PASSWORD='<strong one-time password>'
export POSTGRES_PASSWORD='<strong database password>'
export DATABASE_URL='postgres://dungeon:<url-encoded-database-password>@db:5432/dungeon'
docker compose up --build -d
```

The app container waits for PostgreSQL, applies migrations, runs idempotent admin bootstrap, and starts `node build/index.js` on port 3000. Once the first administrator exists, unset `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD`; later starts will not require them. Put the app behind an HTTPS reverse proxy, preserve forwarded host/origin behavior, and keep secure cookies enabled. The named volume `db_data` is persistent but is not a backup.

## GHCR publishing and package permissions

A GitHub Actions image workflow should authenticate with `docker/login-action` and build/push `ghcr.io/<owner>/dungeon-endless:<tag>`. Grant the workflow only:

```yaml
permissions:
  contents: read
  packages: write
```

Use the repository `GITHUB_TOKEN` for publishing. In the package settings, link the package to the repository and grant that repository Actions access. Public packages can usually be pulled anonymously; private/internal packages require a classic personal access token with at least `read:packages` (and repository access when applicable), supplied to `docker login ghcr.io`. Do not put registry tokens in Compose files.

To deploy a published image, replace the Compose app service's `build:` block with:

```yaml
image: ghcr.io/<owner>/dungeon-endless:<immutable-tag-or-digest>
```

Pin production deployments to an immutable version or digest rather than `latest`. Database migration compatibility must be reviewed before rollback.

## PostgreSQL backups

Back up the database independently of the Docker volume and test restores regularly. For a consistent logical backup:

```sh
docker compose exec -T db pg_dump -U dungeon -d dungeon -Fc > dungeon-$(date +%F).dump
```

Restore into an empty, compatible database with `pg_restore --clean --if-exists --no-owner`. Stop application writes or use an operationally appropriate snapshot/PITR process during restore. Encrypt backups, restrict access, retain multiple generations off-host, monitor backup jobs, and document the matching application image and migration level. PostgreSQL base backups plus archived WAL are preferable when point-in-time recovery is required.

## Security and content limitations

- Cookie authentication uses opaque tokens whose SHA-256 hashes are stored. State-changing forms enforce same-origin Origin/Referer checks. Deploy only behind HTTPS and a trusted proxy.
- Model endpoint URL policy rejects disallowed literal and resolved addresses but native `fetch` cannot pin the validated address, leaving residual DNS-rebinding risk between validation and connection. Keep private/insecure endpoint allowances disabled and enforce network-level egress controls that block private, link-local, metadata, and other sensitive ranges.
- User, editor, and model text is rendered as escaped Svelte text; raw HTML is not used. Prompt delimiters reduce prompt-injection impact, while authoritative rules remain server-side.
- Generated text can still be inaccurate, offensive, or outside the requested tone. Endpoint operators must select appropriate models, apply provider controls, moderate custom editor content, and provide any legally required age gate. Character age is profile-only and is not an access or content gate; it is not identity or age verification.
- The application does not claim compliance with a particular jurisdiction, child-safety regime, privacy standard, or content-rating system. Review those obligations before public deployment.
- Do not log model secrets, session cookies, database URLs, unredacted private content, or player adult-content prompts. Configure infrastructure logs accordingly.

## Future party and multiplayer scope

The current authority model is intentionally one owner, one character, and one active run per character. Party play, spectators, shared turns, invitations, chat, PvP, simultaneous initiative, trading, shared loot, and cross-owner run access are not implemented. Adding them requires explicit membership and permission tables, turn/initiative rules, concurrency and disconnect handling, moderation/reporting, privacy controls, and revised settlement/idempotency semantics. A run UUID alone must never become an authorization capability.

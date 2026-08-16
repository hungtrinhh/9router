# 9Router Agent Notes

This checkout is the user's fork. Treat the current code and manifests as authoritative; do not assume upstream behavior or overwrite fork-specific changes.

## Boundaries

- The root package (`9router-app`) is the private Next.js dashboard and routing gateway. `cli/` is a separately versioned/published npm package (`9router`) with its own dependencies and build.
- `src/` owns Next routes, dashboard code, account selection, and app-side gateway glue. `open-sse/` is the provider-agnostic execution/translation engine. Read `open-sse/AGENTS.md` before changing that subtree.
- `tests/` is an independent ESM/Vitest package, not a root workspace and not wired to a root `npm test`.
- The main chat path is `src/app/api/v1/*` (via rewrites in `next.config.mjs`) -> `src/sse/handlers/chat.js` (combo/account fallback) -> `open-sse/handlers/chatCore.js` (format detection, translation, executor, retry/refresh, streaming).

## Commands

- Install app dependencies at the root: `npm install`. Copy `.env.example` to `.env` for local runtime configuration.
- Source dev server: `npm run dev` on port `20127`. `PORT=...` does not override the script's explicit `--port 20127`; use `npx next dev --webpack --port <port>` when another port is required.
- Production verification: `npm run build`; the postbuild script copies assets into the standalone output. Start with `npm run start` (source default `20127`) or run the standalone artifact. Docker and the published CLI default to `20128`.
- Lint: `npx eslint .`. There is no formatter or typecheck script.
- CLI: `npm --prefix cli install`, `npm --prefix cli run dev`, `npm run cli:pack`. The root and `cli/package.json` versions are independent release surfaces even when currently equal.
- Tests require root dependencies first, then `npm --prefix tests install`. Run all tests with `npm --prefix tests test`; run one file with `npm --prefix tests exec vitest run -- unit/capabilities.test.js`.
- Run translator tests from `tests/`, where the nested `AGENTS.md` applies: `npm --prefix tests exec vitest run -- translator/`. Files calling translation APIs must import `tests/translator/registerAll.js` so side-effect registrations occur under Vitest ESM.
- `tests/translator/real/*.real.test.js` makes live provider calls and requires `RUN_REAL=1` plus credentials. Do not include it in routine offline verification.

## Test Baselines

- A plain full-suite run has committed known failures; do not treat raw red count as a regression signal. The authoritative list is `tests/__baseline__/known-fails.txt`.
- `tests/unit/embeddings.cloud.test.js` references the out-of-repo `cloud/` worker and cannot collect in this checkout.
- `tests/__baseline__/verify-no-regression.mjs` expects a Vitest JSON result path: `node tests/__baseline__/verify-no-regression.mjs <results.json>`.
- After provider, alias, or OAuth endpoint changes, run the focused tests plus `node tests/__baseline__/verify-providers.mjs`, `node tests/__baseline__/verify-alias.mjs`, and `node tests/__baseline__/verify-oauth-urls.mjs` as applicable. Do not refresh snapshots merely to make an unintended change pass.

## Fork Release Process

- App/Docker releases use a `v<root package version>` annotated tag. For a release that changes the app bundled by the CLI, keep `package.json` and `cli/package.json` aligned, add the dated release notes at the top of `CHANGELOG.md`, and do not rewrite the historically stale root lockfile version unless dependencies are actually being installed or changed.
- Before committing, run the focused tests, `git diff --check`, and `npm run build`. If local Windows filesystem permissions prevent Webpack from scanning user-profile junctions, record that environmental failure and rely on the GitHub CI production build as the release gate.
- Inspect `git status`, `git diff`, and recent history; commit only intended files using the repository's Conventional Commit style. Push the release commit to `origin` before tagging.
- Create an annotated tag (`git tag -a vX.Y.Z -m "vX.Y.Z"`) on the pushed release commit and push that tag. The `docker-publish.yml` tag workflow builds and publishes the fork's multi-platform Docker images.
- Create the GitHub release with `gh release create vX.Y.Z --title "9Router Fork vX.Y.Z" --notes-file <file>`, then return the release URL and Docker workflow status. State explicitly when npm publication is not included; only run `npm run cli:publish` when the user separately requests an npm release.

## Provider And Translation Rules

- Provider definitions live in `open-sse/providers/registry/*.js`; the consolidated static-import file is `open-sse/providers/registry/index.js`. Adding a registry file without adding its static import leaves it invisible at runtime. No verified index generator exists in this checkout, despite the generated-file comment.
- Models and aliases derive from the registry through `open-sse/config/providerModels.js`. OpenAI-compatible providers use `DefaultExecutor`; add/register a custom executor only for non-standard transports.
- Translators register through import side effects in `open-sse/translator/index.js`. A new translator that is not imported there never runs.
- Translation normally pivots through OpenAI and can lose thinking blocks, tool IDs, remote images, and error metadata. Use a direct source/target route for fragile formats. Binary/protobuf/NDJSON transports such as Kiro, Cursor, and CommandCode belong in executors rather than an OpenAI round-trip.
- RTK hooks mutate request bodies in place and must fail open: on compression errors, preserve the original body and never throw. Preserve `is_error`/`status: "error"` tool results.

## Persistence And Runtime

- Primary state is SQLite at `<DATA_DIR>/db/data.sqlite`, not `db.json`. Driver fallback is Bun `bun:sqlite`, then Node `better-sqlite3`, `node:sqlite` on Node >=22.5, then `sql.js`; migrations are under `src/lib/db/migrations/`.
- `src/lib/localDb.js` is a compatibility re-export. Put new persistence logic in `src/lib/db/` repositories and exports rather than extending the shim.
- Default data location is `%APPDATA%/9router` on Windows and `~/.9router` elsewhere. A Unix-style `DATA_DIR` is deliberately ignored on Windows.
- `custom-server.js` is security-sensitive: it derives client IP from the socket, strips spoofable forwarding headers, and trusts proxy headers only from loopback peers. Keep production startup through this wrapper when changing request IP/rate-limit behavior.
- `next.config.mjs` deliberately keeps `open` and SQLite drivers external and copies standalone assets after builds. Do not bundle `open`; its `import.meta.url` otherwise embeds the build machine path and breaks cross-platform releases.

## Repository Conventions

- Application code is JavaScript/ESM; `@/*` maps to `src/*` and `open-sse/*` maps to the engine. `custom-server.js` is intentionally CommonJS.
- Keep provider/model/format constants in `open-sse/config/` and translator enums in `open-sse/translator/schema/`; avoid duplicated role, block, model, URL, and timeout literals.
- Security-sensitive environment variables are documented in `.env.example`; never commit generated `.env`, credentials, database files, or API keys.

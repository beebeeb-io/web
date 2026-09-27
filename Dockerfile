# Beebeeb web app — production build.
# Build context must be the workspace root (parent of repos/) so this can
# reach repos/web/ and packages/shared/ (the @beebeeb/shared mirror).

FROM oven/bun:1 AS builder
WORKDIR /app

# NOTE on wasm: `beebeeb-wasm` is a COMMITTED workspace package
# (repos/web/packages/beebeeb-wasm, resolved via `workspace:*` and copied with
# repos/web/ below) — it is the single source of truth for every web build, NOT
# a fresh core build. To update it, regenerate from core (see repos/web/CLAUDE.md
# "Regenerating beebeeb-wasm"). The old `COPY repos/core/beebeeb-wasm/pkg` + its
# sed were dead since the workspace:* switch (d033366); removed in 0738.

# Shared workspace package — outside the workspace root, bun cannot resolve
# `@beebeeb/shared: workspace:*`, so we copy the package to a known path
# and rewrite the dep to point at it before installing.
COPY packages/shared /shared

# Web sources
COPY repos/web/ ./

# Tailwind v4 falls back to filesystem scanning when .git is missing,
# which avoids needing a git binary in the container.
# `dist` MUST be cleaned too: a stale dist/ copied from the build context can
# leave multiple beebeeb_wasm_bg-*.wasm files, and gen-wasm-sri.mjs's
# files.find() may then hash the WRONG wasm → an SRI integrity mismatch that
# blocks WASM load in the browser (prod incident 2026-06-30).
RUN rm -rf .git node_modules dist

# Swap the @beebeeb/shared workspace-protocol dep to the /shared mirror we
# copied above, then install. (beebeeb-wasm stays workspace:* — its committed
# package travels inside repos/web/ and bun resolves it from there.)
RUN sed -i 's|"@beebeeb/shared": "workspace:\*"|"@beebeeb/shared": "/shared"|' package.json && \
    bun install

# API URL is baked into the JS bundle at build time (Vite replaces
# import.meta.env.VITE_API_URL during the build).
ARG VITE_API_URL=https://api.beebeeb.io
ENV VITE_API_URL=$VITE_API_URL

# Office editor feature flag (task 1567, src/lib/flags.ts's FEATURE_OFFICE_EDITOR)
# — same "inlined at build time" story as VITE_API_URL above. Defaults to
# unset/false: this Dockerfile had NO build-arg wiring for it at all before
# this hosting change (found while trying to build a "flag on" image to
# actually load the editor for this task's own Playwright proof) — meaning
# no image built from it could ever have shipped the editor, regardless of
# what was passed on the `docker buildx build` command line, since an
# undeclared --build-arg is silently ignored and Vite only inlines an env var
# that was actually exported via ENV before the build step. The lead flips
# this to "true" at build time once the feature is ready for real users.
ARG VITE_FEATURE_OFFICE_EDITOR=false
ENV VITE_FEATURE_OFFICE_EDITOR=$VITE_FEATURE_OFFICE_EDITOR

# Error-reporting DSN (task 1369) — same "inlined at build time" story as
# VITE_API_URL above. No default: an empty/unset value keeps the shared
# telemetry reporter (`@beebeeb/shared/telemetry`) a no-op (see
# `reporter.ts::initTelemetry`), so a build that forgets to pass this arg
# fails safe (no reporting) rather than silently defaulting to some DSN. The
# lead passes the real value from `deploy/glitchtip/README.md` at build
# time — it is NEVER hard-coded here.
ARG VITE_ERROR_REPORTING_DSN=
ENV VITE_ERROR_REPORTING_DSN=$VITE_ERROR_REPORTING_DSN

# Build provenance. The build context has no .git (.dockerignore:18) and line 29
# removes any that slipped in, so the SHA must be injected. version.json is a
# non-hashed control file like wasm-sri.json: the SPA-fallback location in
# nginx.conf sets Cache-Control: no-cache on it, so it can never go stale.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Skip the `tsc --noEmit` step that ships in package.json's `build` script.
# Type-checking belongs in CI, not in the production image — and tsc here
# fails to resolve `react` from `/shared/src/*.tsx` because /shared has no
# node_modules of its own. Run vite + the WASM SRI generator directly.
RUN bunx vite build && node gen-wasm-sri.mjs && \
    printf '{"sha":"%s","built_at":"%s"}\n' "$GIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > dist/version.json

# --- Runner ---
FROM nginx:1.27-alpine AS runner
COPY repos/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Office editor bundle (task 1567, hosting lane). Staged by
# scripts/office-bundle-stage.sh from repos/office's own committed
# MANIFEST.sha256 reproducibility record — never a third-party CDN, and
# never this Dockerfile's job to fetch or build it. The directory always
# exists (a tracked .gitkeep — see repos/web/.gitignore), so this COPY never
# fails the image build when the bundle hasn't been staged: the office
# editor is feature-flagged and inert without one (a missing manifest.json
# just 404s; nginx.conf's own /office/manifest.json location and the app's
# OfficeLoaderError already handle that honestly). The .gitkeep itself is
# harmless left in the image (no /office/ location serves a bare directory
# listing) but is removed for tidiness.
COPY repos/web/office-bundle-staging /usr/share/nginx/html/office
RUN rm -f /usr/share/nginx/html/office/.gitkeep

EXPOSE 80

# Healthcheck must hit 127.0.0.1 explicitly — `localhost` resolves to ::1 first
# in busybox getaddrinfo, but our nginx config only listens on IPv4 (`listen 80;`).
# Using `localhost` produces 295+ failed checks at boot in prod even though
# real users reach the site fine via Caddy → IPv4 docker network. See task 0009.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

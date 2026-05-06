# Beebeeb web app — production build.
# Build context must be the workspace root (parent of repos/) so this can
# reach repos/web/, repos/core/beebeeb-wasm/pkg/, and packages/shared/
# (the @beebeeb/shared workspace dep).

FROM oven/bun:1 AS builder
WORKDIR /app

# WASM dep — package.json references it via a relative file path.
COPY repos/core/beebeeb-wasm/pkg /wasm-pkg

# Shared workspace package — outside the workspace root, bun cannot resolve
# `@beebeeb/shared: workspace:*`, so we copy the package to a known path
# and rewrite the dep to point at it before installing.
COPY packages/shared /shared

# Web sources
COPY repos/web/ ./

# Tailwind v4 falls back to filesystem scanning when .git is missing,
# which avoids needing a git binary in the container.
RUN rm -rf .git node_modules

# Rewrite the WASM dep path to the container path AND swap the
# @beebeeb/shared workspace-protocol dep to the file path we copied
# above, then install.
RUN sed -i 's|../../repos/core/beebeeb-wasm/pkg|/wasm-pkg|' package.json && \
    sed -i 's|"@beebeeb/shared": "workspace:\*"|"@beebeeb/shared": "/shared"|' package.json && \
    bun install

# API URL is baked into the JS bundle at build time (Vite replaces
# import.meta.env.VITE_API_URL during the build).
ARG VITE_API_URL=https://api.beebeeb.io
ENV VITE_API_URL=$VITE_API_URL

# Skip the `tsc --noEmit` step that ships in package.json's `build` script.
# Type-checking belongs in CI, not in the production image — and tsc here
# fails to resolve `react` from `/shared/src/*.tsx` because /shared has no
# node_modules of its own. Run vite + the WASM SRI generator directly.
RUN bunx vite build && node gen-wasm-sri.mjs

# --- Runner ---
FROM nginx:1.27-alpine AS runner
COPY repos/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80

# Healthcheck must hit 127.0.0.1 explicitly — `localhost` resolves to ::1 first
# in busybox getaddrinfo, but our nginx config only listens on IPv4 (`listen 80;`).
# Using `localhost` produces 295+ failed checks at boot in prod even though
# real users reach the site fine via Caddy → IPv4 docker network. See task 0009.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

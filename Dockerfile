# Beebeeb web app — production build.
# Build context must be the workspace root (parent of repos/) so this can
# reach both repos/web/ and repos/core/beebeeb-wasm/pkg/.

FROM oven/bun:1 AS builder
WORKDIR /app

# WASM dep — package.json references it via a relative file path.
COPY repos/core/beebeeb-wasm/pkg /wasm-pkg

# Web sources
COPY repos/web/ ./

# Tailwind v4 falls back to filesystem scanning when .git is missing,
# which avoids needing a git binary in the container.
RUN rm -rf .git node_modules

# Rewrite the WASM dep path to the container path, then install.
RUN sed -i 's|../../repos/core/beebeeb-wasm/pkg|/wasm-pkg|' package.json && \
    bun install

# API URL is baked into the JS bundle at build time (Vite replaces
# import.meta.env.VITE_API_URL during the build).
ARG VITE_API_URL=https://api.beebeeb.io
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

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

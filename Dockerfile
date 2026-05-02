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

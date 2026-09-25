# Contributing to Beebeeb Web

Thanks for your interest in contributing to the Beebeeb web client.

## Prerequisites

- [Bun](https://bun.sh/) (package manager)
- Node.js 20+
- Git

## Development setup

```sh
git clone https://github.com/beebeeb-io/web.git
cd web
bun install
bun dev
```

The dev server starts at `http://localhost:5173`.

### The API server is not open source

The beebeeb API server is not a public repository, so a clone of this repo cannot run the
full stack. You can install, type-check, run the unit tests, build, and work on the screens
that render without an account (sign-in, sign-up). Signed-in flows need an API server on
`localhost:3001`; the hosted API at `api.beebeeb.io` does not accept browser requests from a
local dev server. Maintainers run the full-stack Playwright specs against an internal API
server before merging. If your change touches a signed-in flow, say so in the pull request and
we will test it with you.

## Tech stack

- React 19, Vite 6, Tailwind CSS 4, TypeScript
- WASM crypto from the committed workspace package `packages/beebeeb-wasm` (the Rust
  [core](https://github.com/beebeeb-io/core) compiled to WebAssembly)
- Shared UI and the API client from the workspace package `packages/shared` (`@beebeeb/shared`)

## Code quality checks

Run these before submitting a pull request:

```sh
bunx tsc --noEmit
bun test
bun run build
```

## Browser and Playwright checks

For user-visible UI changes, include a screenshot of the changed screen in the
pull request. The Playwright specs under `e2e/` need a running API server, so
maintainers run them before merging rather than in a plain clone.

## Pull request process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes, ensuring all checks above pass.
3. Test UI changes visually in the browser, using Playwright for interactive or
   visual behavior.
4. Open a pull request with a clear description of what and why.

## Contributor license

Beebeeb does not require a separate Contributor License Agreement at this time.
By opening a pull request, you confirm you have the right to submit the work and
agree that it is licensed under AGPL-3.0-or-later.

## Security

If you discover a security vulnerability, **do not open a public issue**. Email [security@beebeeb.io](mailto:security@beebeeb.io) instead.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-or-later](LICENSE).

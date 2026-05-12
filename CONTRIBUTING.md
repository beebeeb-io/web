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

The dev server starts at `http://localhost:5173`. You'll need the API server running on `localhost:3001` for full functionality.

## Tech stack

- React 19, Vite 6, Tailwind CSS 4, TypeScript
- WASM crypto loaded via `@beebeeb/shared`

## Code quality checks

Run these before submitting a pull request:

```sh
bunx tsc --noEmit
bun run build
```

## Pull request process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes, ensuring all checks above pass.
3. Test UI changes visually in the browser.
4. Open a pull request with a clear description of what and why.

## Security

If you discover a security vulnerability, **do not open a public issue**. Email [security@beebeeb.io](mailto:security@beebeeb.io) instead.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-or-later](LICENSE).

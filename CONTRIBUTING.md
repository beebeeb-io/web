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

## Browser and Playwright checks

Use Playwright for user-visible UI changes. Start the API server on
`localhost:3001`, start the web client with `bun dev`, then run the relevant
Playwright spec or capture browser evidence for the changed flow before opening
a pull request.

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

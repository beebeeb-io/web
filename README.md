<p align="center">
  <img src="https://beebeeb.io/icon.png" alt="Beebeeb" width="60" />
</p>
<h3 align="center">Beebeeb Web</h3>
<p align="center">End-to-end encrypted cloud storage. Made in Europe.</p>

<p align="center">
  <a href="https://github.com/beebeeb-io/web/blob/main/LICENSE"><img src="https://img.shields.io/github/license/beebeeb-io/web" alt="License"></a>
  <a href="https://github.com/beebeeb-io/web/actions"><img src="https://img.shields.io/github/actions/workflow/status/beebeeb-io/web/ci.yml?branch=main" alt="CI"></a>
  <a href="https://github.com/beebeeb-io/web/stargazers"><img src="https://img.shields.io/github/stars/beebeeb-io/web" alt="Stars"></a>
</p>

---

The web client for [Beebeeb](https://beebeeb.io) -- the browser-based interface where you manage files, folders, shares, and account settings. All encryption and decryption happens in your browser via WebAssembly. The server never sees your plaintext data, file names, or encryption keys.

Built and operated by [Initlabs B.V.](https://initlabs.nl), Wijchen, Netherlands.

<!-- TODO: Replace with actual screenshot once the app is live -->
<!-- ![Beebeeb Drive](docs/screenshot-drive.png) -->

## Features

- **Zero-knowledge encryption** -- files are encrypted with AES-256-GCM before upload; decrypted after download. The server stores only ciphertext.
- **File browser** -- navigate folders, drag-and-drop upload, rename, move, trash, and restore.
- **File preview** -- images, PDFs, video, markdown, and plain text rendered in-browser. No server-side processing.
- **Sharing** -- create time-limited, optionally passphrase-protected share links. The share key lives in the URL fragment and never reaches the server.
- **Folder sharing** -- share entire folders with per-folder key wrapping. Recipients see a read-only or read-write drive.
- **Version history** -- browse and restore previous versions of any file.
- **Photos view** -- date-grouped grid with thumbnails.
- **Search** -- find files by name (decrypted locally).
- **Context menus and bulk actions** -- right-click or select multiple files for batch operations.
- **Command palette** -- keyboard-driven navigation.
- **Dark mode** -- system-aware with manual override.
- **Security center** -- active sessions, two-factor authentication, passkey management, recovery phrase verification.
- **Settings** -- profile, devices, notifications, language, appearance.
- **Billing** -- plan management, usage, invoices.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 (OKLCH color system) |
| Language | TypeScript |
| Routing | react-router-dom 7 |
| Crypto | WebAssembly ([beebeeb-core](https://github.com/beebeeb-io/core)) |
| Testing | Playwright |
| Package manager | Bun |

## Getting started

### Prerequisites

- [Bun](https://bun.sh) (latest)
- The [Beebeeb API server](https://github.com/beebeeb-io/server) running on `localhost:3001`

### Install and run

```sh
git clone https://github.com/beebeeb-io/web.git
cd web
bun install
bun dev
```

The dev server starts at `http://localhost:5173`.

### Other commands

```sh
bun run build        # Production build
bunx tsc --noEmit    # Type-check without emitting
```

### Full-stack development

The easiest way to run everything locally:

```sh
# From the workspace root (beebeeb.io/)
docker compose up -d postgres        # Postgres 17 on localhost:5434
cd repos/server && cargo run          # API on localhost:3001
cd repos/web && bun dev               # Web on localhost:5173
```

## Project structure

```
src/
  app.tsx                     Route definitions
  main.tsx                    Entry point
  index.css                   Tailwind config and design tokens (@theme)
  pages/
    login.tsx                 Authentication
    signup.tsx                Registration
    onboarding.tsx            Recovery phrase setup
    drive.tsx                 Main file browser
    photos.tsx                Photo grid view
    starred.tsx               Starred files
    recent.tsx                Recent files
    shared.tsx                Files shared with you
    trash.tsx                 Trashed files
    search.tsx                Search results
    share-view.tsx            Public share view (no auth required)
    security.tsx              Security center
    billing.tsx               Billing management
    pricing.tsx               Plan selection
    settings/                 Profile, devices, notifications, language
    admin/                    SSO, audit log, API tokens, compliance
    errors/                   404 and error pages
  components/
    bb-button.tsx             Core UI primitives
    bb-input.tsx
    bb-chip.tsx
    bb-checkbox.tsx
    bb-toggle.tsx
    bb-logo.tsx
    icons.tsx                 SVG icon set
    drive-layout.tsx          Main layout with sidebar
    auth-shell.tsx            Layout shell for auth pages
    settings-shell.tsx        Layout shell for settings pages
    upload-zone.tsx           Drag-and-drop upload
    upload-progress.tsx       Upload progress indicator
    share-dialog.tsx          Share link creation
    context-menu.tsx          Right-click file actions
    move-modal.tsx            Move files between folders
    new-folder-dialog.tsx     Create folder
    version-history.tsx       File version history
    command-palette.tsx       Keyboard-driven navigation
    preview/                  Image, PDF, video, markdown preview
    empty-states/             Empty drive, search, errors
  lib/
    api.ts                    API client
    auth-context.tsx          Authentication state
    crypto.ts                 Encryption/decryption via WASM
    key-context.tsx           Key management context
    encrypted-upload.ts       Client-side encrypt-then-upload
    encrypted-download.ts     Download-then-decrypt
  hooks/
    use-file-preview.ts       File preview logic
e2e/
  auth.spec.ts                End-to-end auth tests
```

## Design system

The UI is built on a custom design system:

- **Colors** use OKLCH for perceptual uniformity. Warm paper/ink tones, with amber (`oklch(0.82 0.17 84)`) reserved strictly for encryption indicators and primary calls to action.
- **Typography** pairs Inter (UI text) with JetBrains Mono (hashes, IDs, timestamps, file sizes). Rule: "if you can't read it aloud, it's mono."
- **Spacing** follows a 4px base grid.
- **Copy** is honest and precise. "We can't recover this" instead of "bank-grade security."

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Make your changes
4. Ensure the pre-commit hook passes (secret scanning)
5. Open a pull request against `main`

## Security

All encryption happens in the browser. The server never has access to your keys or plaintext data.

If you discover a security vulnerability, please email [security@beebeeb.io](mailto:security@beebeeb.io). We aim to acknowledge reports within 48 hours.

## License

[GNU Affero General Public License v3.0](LICENSE)

Copyright (c) Initlabs B.V.

## Part of Beebeeb

| Repository | Description |
|---|---|
| **[web](https://github.com/beebeeb-io/web)** | Web client (you are here) |
| [core](https://github.com/beebeeb-io/core) | Cryptographic core, shared types, sync engine |
| [cli](https://github.com/beebeeb-io/cli) | `bb` -- CLI for encrypted cloud storage |
| [desktop](https://github.com/beebeeb-io/desktop) | Desktop sync for macOS, Windows, Linux |
| [mobile](https://github.com/beebeeb-io/mobile) | iOS and Android app |
| [site](https://github.com/beebeeb-io/site) | Marketing website |

[beebeeb.io](https://beebeeb.io)

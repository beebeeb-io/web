<p align="center">
  <h3 align="center">Beebeeb Web</h3>
  <p align="center">Web client for Beebeeb — encrypted file management in your browser. Zero-knowledge by default.</p>
</p>

<p align="center">
  <a href="https://github.com/beebeeb-io/web/blob/main/LICENSE"><img src="https://img.shields.io/github/license/beebeeb-io/web" alt="License"></a>
  <a href="https://github.com/beebeeb-io/web/actions"><img src="https://img.shields.io/github/actions/workflow/status/beebeeb-io/web/ci.yml?branch=main" alt="CI"></a>
  <a href="https://github.com/beebeeb-io/web/graphs/contributors"><img src="https://img.shields.io/github/contributors/beebeeb-io/web" alt="Contributors"></a>
  <a href="https://github.com/beebeeb-io/web/stargazers"><img src="https://img.shields.io/github/stars/beebeeb-io/web" alt="Stars"></a>
  <a href="https://github.com/beebeeb-io/web/issues"><img src="https://img.shields.io/github/issues/beebeeb-io/web" alt="Issues"></a>
</p>

---

## What is Beebeeb?

Beebeeb is end-to-end encrypted cloud storage. Your files are encrypted before they leave your device and can only be decrypted by you. The server never sees your data, your keys, or your plaintext.

This is the **web client** — the browser-based interface where users manage files, folders, shares, and account settings.

> All encryption happens in this client via WebAssembly. The server never sees your data.

## Screenshots

Screenshots coming soon. The UI follows a custom design system built around OKLCH colors, an amber accent palette, and Inter + JetBrains Mono typography.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 4 |
| Language | TypeScript |
| Routing | react-router-dom 7 |
| Crypto | WebAssembly (`beebeeb-wasm`) |
| Testing | Playwright (e2e) |
| Package manager | Bun |

## Getting started

### Prerequisites

- [Bun](https://bun.sh) (latest)
- The [Beebeeb API server](https://github.com/beebeeb-io/server) running at `http://localhost:3001`

### Clone, install, and run

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

## Project structure

```
src/
  app.tsx                   # Root component and route definitions
  main.tsx                  # Entry point
  index.css                 # Tailwind config and design tokens (@theme)
  pages/
    login.tsx               # Authentication
    signup.tsx
    onboarding.tsx          # Recovery phrase setup
    drive.tsx               # Main file browser
    photos.tsx              # Photo grid view
    trash.tsx               # Trashed files
    search.tsx              # Search results
    share-view.tsx          # Public share recipient view (no auth)
    security.tsx            # Security center
    billing.tsx             # Billing management
    pricing.tsx             # Plan selection
    settings/               # Profile, devices, notifications, language
    admin/                  # SSO, audit log, API tokens, compliance, data export
    errors/                 # Error pages
  components/
    bb-button.tsx           # Core UI primitives
    bb-input.tsx
    bb-chip.tsx
    bb-checkbox.tsx
    bb-toggle.tsx
    bb-logo.tsx
    icons.tsx               # 24 SVG icons
    auth-shell.tsx          # Layout shell for auth pages
    settings-shell.tsx      # Layout shell for settings pages
    upload-zone.tsx         # Drag-and-drop upload
    upload-progress.tsx     # Upload progress indicator
    share-dialog.tsx        # Share link creation
    context-menu.tsx        # Right-click file actions
    move-modal.tsx          # Move files between folders
    new-folder-dialog.tsx   # Create folder
    version-history.tsx     # File version history
    upgrade-dialog.tsx      # Plan upgrade prompt
    file-icon.tsx           # File type icons
    preview/                # Image, PDF, video, markdown preview
    empty-states/           # Empty drive, search, errors
  lib/
    api.ts                  # API client
    auth-context.tsx        # Authentication state
    crypto.ts               # Encryption/decryption via WASM
    key-context.tsx         # Key management context
    encrypted-upload.ts     # Client-side encrypt-then-upload
    encrypted-download.ts   # Download-then-decrypt
  hooks/
    use-file-preview.ts     # File preview logic
e2e/
  auth.spec.ts              # End-to-end auth tests (Playwright)
```

## Design system

The UI is built on a purpose-built design system:

- **Colors** use OKLCH for perceptual uniformity. Warm paper/ink tones, with amber reserved strictly for encryption indicators and primary calls to action.
- **Typography** pairs Inter (UI text) with JetBrains Mono (hashes, IDs, timestamps, file sizes).
- **Spacing** follows a 4px base grid.
- **Copy** is honest and precise. "We can't recover this" instead of "bank-grade security."

## Contributing

Contributions are welcome. To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Ensure pre-commit hooks pass
5. Open a pull request

Please read [SECURITY.md](SECURITY.md) before submitting security-related changes.

## Security

If you discover a security vulnerability, please report it responsibly. See [SECURITY.md](SECURITY.md) for details.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

Copyright (C) 2025-2026 [Initlabs B.V.](https://initlabs.nl)

## Part of Beebeeb

| Repository | Description |
|-----------|-------------|
| [web](https://github.com/beebeeb-io/web) | Web client (you are here) |
| [mobile](https://github.com/beebeeb-io/mobile) | iOS and Android app |
| [server](https://github.com/beebeeb-io/server) | API server |
| [site](https://github.com/beebeeb-io/site) | Marketing website |

[beebeeb.io](https://beebeeb.io)

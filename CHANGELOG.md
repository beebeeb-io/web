# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `/receive` (Constellation transfer): real X25519 + HKDF transfer-key derivation and AES-256-GCM decrypt of the received blob + filename, SAS words derived from the shared secret (authenticates the key exchange). End-to-end once the mobile sender produces real transfer-key blobs. (task 0855b)

### Fixed
- Trash: "Empty trash" and "Restore all" now act on EVERY trashed item (full listing via `listAllFiles`), not just the first ~200; permanent delete batches into ≤500-id requests. (QA #4)
- Settings → Data Residency: read `available_regions`/`example_city` (was a non-existent field → stuck on one region); selecting a region sends `preferred_region` (was silently clearing it). (QA #6/#7)
- Settings → Security Activity: render real `description`/`device`/`country_code` + the server's actual event names with proper paging (was blank columns + a false "no events" empty state + infinite "Load more"). (QA #15/#16)
- Drive/Recent/Starred: file-details Trash now trashes (was only closing the panel); Move + Star/Unstar wired on all three pages. (QA #10/#11/#12)
- Move dialog: removed the mislabeled "Copy here" button that actually MOVED the file (no copy endpoint exists). (QA #1)
- Trash: empty/multi-select permanent delete send ONE `POST /files/permanent`; multi-select move-to-trash sends ONE `POST /files/trash`. (task 0832)

### Removed
- Nothing yet.

### Security
- Step-up confirm (`confirmAction`) uses the OPAQUE handshake against `/auth/confirm-opaque-{start,finish}` — the plaintext password no longer leaves the browser for OPAQUE accounts (legacy Argon2 accounts fall back to `/auth/confirm`). (task 0854a)

## [1.0.0] - 2026-05-13

### Added
- Encrypted file management with upload, download, rename, and delete
- Folder sharing with link-based access and permission controls
- File preview for images, PDFs, video, audio, and text
- Drag-and-drop upload with progress tracking
- Starred, recent, and trash views
- Stripe billing integration with plan management
- Passkey (WebAuthn) authentication
- Public user profiles
- Responsive layout for desktop and mobile browsers

### Changed
- Nothing yet.

### Fixed
- Nothing yet.

### Removed
- Nothing yet.

### Security
- Client-side encryption and decryption via WASM (core library)
- Self-hosted Inter and JetBrains Mono fonts (no Google or Cloudflare CDN)

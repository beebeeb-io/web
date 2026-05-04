/**
 * Migration Mission Control types.
 *
 * Shared between the streaming WebSocket events (`MigrationFileEvent`) and the
 * structured snapshot view (`MigrationFileEntry`). Mirrors the shapes defined
 * in spec 014 — keep these in sync with the server-side event bus payloads
 * once the WS endpoint lands.
 */

export type MigrationFileEventType =
  | 'file_started'
  | 'file_progress'
  | 'file_done'
  | 'file_failed'

/**
 * A single event streamed from the migration worker over WebSocket.
 *
 * Field optionality follows the union of variants — only `type`, `file_id`,
 * and `at` are present on every event. The component code derives a visible
 * status from `type` so all variants can be rendered in a single timeline.
 */
export interface MigrationFileEvent {
  type: MigrationFileEventType
  file_id: string
  size_bytes?: number
  chunks?: number
  chunks_copied?: number
  bytes_copied?: number
  duration_ms?: number
  error?: string
  /** ISO-8601 timestamp produced server-side. */
  at: string
}

export type MigrationFileStatus =
  | 'pending'
  | 'copying'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled'

/** A file_migrations row, used for the structured Table view. */
export interface MigrationFileEntry {
  file_id: string
  status: MigrationFileStatus
  size_bytes: number
  started_at: string | null
  completed_at: string | null
  error: string | null
  bytes_copied: number
}

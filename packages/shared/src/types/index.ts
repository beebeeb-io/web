/**
 * Shared TypeScript interfaces copied from repos/web/src/lib/api.ts.
 *
 * These describe server JSON contracts consumed by web, admin, and future
 * Beebeeb clients. Keep this file dependency-free so type-only imports never
 * pull in React or app-local runtime code.
 */

export type ErrorNotifier = (message: string) => void

export type SessionExpiredHandler = () => void

export type ConnectionStatusHandler = (status: 'ok' | 'flaky') => void

export interface AuthSessionResponse {
  user_id: string
  session_token: string
  salt: string
}

export interface AuthUser {
  user_id: string
  email: string
  email_verified: boolean
  created_at: string
  frozen_at?: string | null
  totp_enabled: boolean
  two_factor_enabled?: boolean
  twoFactorEnabled?: boolean
  /** True when the current session was created via admin impersonation. */
  is_impersonation?: boolean
  /** UUID of the admin who issued the impersonation, when `is_impersonation`. */
  admin_user_id?: string | null
}

export interface SignupResult {
  session_token: string
  salt: string
  user_id: string
}

export interface LoginResult {
  requires_2fa?: boolean
  partial_token?: string
  user_id?: string
  session_token?: string
  salt?: string
}

export interface TotpSetupResponse {
  secret: string
  qr_uri: string
  backup_codes: string[]
}

export interface DriveFile {
  id: string
  name_encrypted: string
  /** Null for files uploaded after the ZK audit fix (commit 04d5288).
   *  Infer type from decrypted filename extension instead. */
  mime_type: string | null
  size_bytes: number
  is_folder: boolean
  parent_id: string | null
  chunk_count: number
  is_starred?: boolean
  has_thumbnail?: boolean
  version_number?: number
  /** Number of active (non-revoked, non-expired) share links for this file.
   *  Populated by a LEFT JOIN in the server's list_files handler. */
  share_count?: number
  /** Encrypted file note. JSON string { nonce: string, ciphertext: string } (base64).
   *  Null when no note has been set. Decrypted client-side with the file key. */
  note_encrypted?: string | null
  created_at: string
  updated_at: string
}

export interface UploadStatusResponse {
  file_id: string
  chunk_count: number
  uploaded_chunks: number[]
  is_uploading: boolean
}

export interface SyncNode {
  id: string
  name_encrypted: string
  parent_id: string | null
  is_folder: boolean
  size_bytes: number
  mime_type: string | null
  content_hash: string | null
  version_number: number
  has_thumbnail: boolean
  storage_pool_id: string | null
  is_trashed: boolean
  is_starred: boolean
  chunk_count?: number
  created_at: string
  updated_at: string
}

export interface SyncOp {
  seq_id: number
  op_type: string
  client_op_id?: string
  payload: Record<string, unknown>
  device_id?: string
  created_at: string
}

export interface SyncSnapshot {
  seq_id: number
  nodes: SyncNode[]
}

export interface SubmittedSyncOp {
  client_op_id: string
  op_type: string
  payload: Record<string, unknown>
  device_id?: string
}

export interface SyncOpsResult {
  applied: { seq_id: number; client_op_id: string }[]
  rejected: {
    client_op_id: string
    reason: string
    winning_op?: { op_type: string; payload: Record<string, unknown> }
  }[]
}

export interface StreamTokenResponse {
  stream_token: string
  expires_at: string
}

export interface AccountExport {
  user_id: string
  email: string
  exported_at: string
  preferences: Record<string, unknown>
  files: unknown[]
  shares: unknown[]
}

export interface ShareOptions {
  expires_in_hours?: number | null
  max_opens?: number | null
  passphrase?: string
  /**
   * When set, the client has wrapped the file key under a client-generated key
   * (double-encrypted mode). The server stores this opaque blob and returns it
   * to recipients — the server cannot decrypt it without the client key that
   * lives only in the URL fragment.
   * Format: base64(nonce(12) || AES-256-GCM-ciphertext(48)) = 80 chars.
   */
  wrapped_file_key?: string
}

export interface ShareInfo {
  id: string
  token: string
  url: string
  expires_at: string | null
  max_opens: number | null
  has_passphrase: boolean
  created_at: string
  /** True when the client supplied wrapped_file_key at creation time. */
  double_encrypted?: boolean
}

export interface ShareView {
  id: string
  name_encrypted?: string
  size_bytes?: number
  chunk_count?: number
  mime_type?: string
  shared_by?: string
  /** User ID of the person who created the share — for referral attribution. */
  sharer_id?: string
  expires_at?: string | null
  max_opens?: number | null
  open_count?: number
  created_at?: string
  requires_passphrase?: boolean
  error?: string
  message?: string
  /**
   * True when the share was created in double-encrypted mode.
   * When true, wrapped_file_key is present and the #key= fragment contains
   * the client key K_c — not the file key directly.
   * Recipients must: fileKey = AES-GCM-Decrypt(K_c, wrapped_file_key).
   */
  double_encrypted?: boolean
  /**
   * Base64-encoded wrapped file key (nonce || ciphertext, 60 bytes).
   * Only present when double_encrypted === true.
   * The server stores this opaque blob; decryption requires K_c from the URL fragment.
   */
  wrapped_file_key?: string
}

export interface MyShare {
  id: string
  file_id: string
  token: string
  url: string
  expires_at: string | null
  max_opens: number | null
  open_count: number
  last_opened_at?: string | null
  has_passphrase: boolean
  revoked?: boolean
  created_at: string
  file: {
    name_encrypted: string
    size_bytes: number
    mime_type: string | null
  }
}

export interface SharedFileDownload {
  blob: Blob
  chunkCount: number | null
  originalSize: number | null
}

export interface ShareInvite {
  id: string
  file_id: string
  sender_id: string
  recipient_email: string
  status: string
  created_at: string
  claimed_at?: string
  approved_at?: string
  file_name_encrypted?: string
  sender_email?: string
  sender_public_key?: string
  recipient_public_key?: string
  can_reshare?: boolean
  expires_at?: string | null
  size_bytes?: number
  is_folder?: boolean
  chunk_count?: number
  mime_type?: string
  encrypted_file_key?: string
  is_folder_share?: boolean
  encrypted_folder_key?: string
  encrypted_owner_folder_key?: string
}

export interface InviteActivity {
  recipient_email: string
  created_at: string
  claimed_at: string | null
  approved_at: string | null
  download_count: number
  last_accessed: string | null
  first_accessed: string | null
}

export interface ShareStats {
  active_links: number
  pending_invites: number
  total_downloads: number
}

export interface Plan {
  id: string
  name: string
  stripe_product_id?: string | null
  price_eur: number
  price_yearly_eur: number
  storage_bytes: number
  storage_label: string
  per_seat: boolean
  min_seats: number
  features: string[]
  is_active?: boolean
  sort_order?: number
  badge?: string | null
  stripe_updated_at?: string | null
  local_updated_at?: string | null
  last_pushed_at?: string | null
}

export interface BillingSyncResult {
  /** Total plans upserted (server field: synced) */
  synced: number
  /** Alias for synced — server may return either */
  count?: number
  plans_synced?: number
  created: number
  updated: number
  synced_at: string
  message?: string
}

export interface PlanUpdateInput {
  name?: string
  price_eur?: number
  price_yearly_eur?: number
  storage_bytes?: number
  features?: string[]
  is_active?: boolean
  sort_order?: number
  badge?: string | null
  force_push?: boolean
}

export interface PlanUpdateResponse {
  plan: Plan
  stripe_synced: boolean
  note?: string
}

export interface Subscription {
  plan: string
  billing_cycle: string
  seats: number
  region: string
  status: string
  is_mock?: boolean
  created_at: string | null
  current_period_end: string | null
}

export interface Invoice {
  id: string
  number: string
  date: string
  amount_eur: number
  status: string
  period: string
  url?: string
  pdf_url?: string
}

export interface StorageUsage {
  used_bytes: number
  plan_limit_bytes: number
  plan_name: string
}

export interface BillingUsage {
  used_bytes: number
  quota_bytes: number
  /** Server-computed percentage 0–100. */
  percentage: number
}

export interface PaymentMethod {
  type: string
  brand?: string
  last4?: string
  exp_month?: number
  exp_year?: number
  iban_last4?: string
  is_default: boolean
}

export interface ReferralStats {
  code: string
  referral_count: number
  earned_gb: number
}

export interface ReferralEntry {
  /** Anonymised display, e.g. "a***@example.com" */
  display_email: string
  joined_at: string
  status: 'active' | 'pending'
}

export interface PersonalAccessToken {
  id: string
  name: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export interface CreateTokenResponse {
  id: string
  /** Raw token — shown exactly once. Server never returns it again. */
  token: string
  name: string
  scopes: string[]
  expires_at: string | null
}

export interface CreateTokenParams {
  name: string
  scopes: string[]
  /** ISO duration string or null for no expiry — e.g. "P30D" */
  expires_in_days: number | null
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  is_active: boolean
  last_triggered_at: string | null
  failure_count: number
  created_at: string
}

export interface CreateWebhookResponse {
  id: string
  url: string
  /** Signing secret — returned once on creation, never again. */
  secret: string
  events: string[]
  is_active: boolean
}

export interface AuditEvent {
  id: string
  workspace_id: string | null
  actor: string
  event: string
  target: string | null
  ip_address: string | null
  device: string | null
  created_at: string
}

export interface WorkspaceMember {
  id: string
  email: string
  email_verified: boolean
  joined_at: string
}

export interface AdminUser {
  id: string
  email: string
  created_at: string
  email_verified: boolean
  plan: string
  storage_used_bytes: number
}

export interface AdminUsersResponse {
  users: AdminUser[]
  total: number
  limit: number
  offset: number
}

export interface AdminUserDetail {
  id: string
  email: string
  email_verified: boolean
  /** Top-level account role. Server adds this in `7be299a` for task 0018. */
  role: 'user' | 'admin' | 'superadmin'
  created_at: string
  plan: string
  billing_cycle: string | null
  subscription_status: string | null
  current_period_end: string | null
  storage_bytes: number
  file_count: number
  share_count: number
  session_count: number
  last_login: string | null
  workspaces: { id: string; name: string; role: string; joined_at: string }[]
  plan_limit_bytes?: number
  /** Whether the account uses OPAQUE (true) or legacy Argon2id (false/absent). */
  opaque_enrolled?: boolean
  /**
   * Backward-compat alias for `is_disabled`. Both fields reflect the same
   * `users.disabled_at` column after the task 0160 reconciliation.
   */
  is_suspended?: boolean
  /** Admin "kill switch" — when true, login returns 403 account_disabled. */
  is_disabled?: boolean
  /** ISO timestamp the kill-switch was set, or null. */
  disabled_at?: string | null
  /**
   * Optional human-readable reason captured at disable time. Currently the
   * server returns null until reasons are wired through the UI.
   */
  disabled_reason?: string | null
  /** Referral + admin-granted bonus storage on top of the plan quota. */
  bonus_storage_bytes?: number
  /** Provenance of the active subscription row: 'stripe', 'admin_override', etc. */
  subscription_source?: string | null
  /** Free-text justification when source = 'admin_override'. */
  subscription_admin_note?: string | null
}

export interface AdminUserFile {
  id: string
  name_encrypted: string | null
  size_bytes: number
  is_folder: boolean
  is_trashed: boolean
  created_at: string
  storage_pool_id: string | null
}

export interface AdminUserFilesResponse {
  user_id: string
  files: AdminUserFile[]
  total_count: number
  total_bytes: number
}

export interface AdminUserSession {
  id: string
  created_at: string
  last_active_at: string | null
  ip_address: string | null
  user_agent: string | null
  device_hint: string | null
}

export interface WaitlistEntry {
  email: string
  source: string | null
  plan: string | null
  storage_tb: number | null
  users: number | null
  details: string | null
  created_at: string
}

export interface WaitlistResponse {
  count: number
  entries: WaitlistEntry[]
}

export interface StoragePool {
  id: string
  name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  /** Human-readable location name shown in region badges. */
  city?: string | null
  /** Continent slug for data-residency display (e.g. "europe") */
  continent?: string | null
  display_name: string
  is_default: boolean
  is_active: boolean
  capacity_bytes: number | null
  used_bytes: number
  usage_pct: number | null
  created_at: string
  lifecycle_phase?: LifecyclePhase
}

export interface MigrationSummary {
  pending: number
  copying: number
  verifying: number
  done: number
  failed: number
  total: number
}

export interface MigrationEntry {
  id: string
  file_id: string
  from_pool: string | null
  to_pool: string | null
  status: string
  chunks_copied: number
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface PoolUsageEntry {
  user_id: string
  email: string
  used_bytes: number
  file_count: number
}

export interface UserStoragePoolEntry {
  pool_id: string
  pool_name: string
  file_count: number
  total_bytes: number
}

export interface UserStorageBreakdown {
  user_id: string
  /** Pools where the user has at least one non-trashed, non-folder file. */
  pools: UserStoragePoolEntry[]
  total_files: number
  total_bytes: number
  plan_name: string
  plan_limit_bytes: number
}

export interface PasskeyInfo {
  id: string
  name: string
  created_at: string
}

export interface PasskeyRegisterStartResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicKey: any
  reg_state: string
}

export interface PasskeyLoginStartResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicKey: any
  auth_state: string
  user_id: string
}

export interface ActivityEvent {
  id: string
  type: string
  subject: string | null
  details: string | null
  where: string | null
  /** Client that triggered the event — "web" | "mobile-ios" | "mobile-android" | "desktop" | "cli" */
  device?: string | null
  created_at: string
}

export interface ActivityResponse {
  events: ActivityEvent[]
  total: number
  page: number
}

export interface AccountActivityEvent {
  id: string
  type: string
  description: string
  category: string
  outcome: string
  device: string | null
  country_code: string | null
  created_at: string
}

export interface AccountActivitySummary {
  last_login_at: string | null
  last_login_device: string | null
  active_sessions: number
  active_shares: number
  security_score: string
}

export interface AccountActivity {
  events: AccountActivityEvent[]
  summary: AccountActivitySummary
}

export interface SecurityFactor {
  key: string
  satisfied: boolean
}

export interface SecurityScore {
  score: number
  max: number
  label: string
  factors: SecurityFactor[]
}

export interface AccountSession {
  id: string
  device_name: string
  device_kind: string
  country_code: string | null
  last_active_at: string | null
  created_at: string
  is_current: boolean
}

export interface Workspace {
  id: string
  name: string
  owner_id: string
  role: string
  created_at: string
}

export interface WorkspaceMemberDetail {
  id: string
  email: string
  role: string
  joined_at: string
}

export interface PendingInvite {
  id: string
  email: string
  role: string
  invited_by: string
  created_at: string
  expires_at: string
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMemberDetail[]
  pending_invites: PendingInvite[]
}

export interface InviteInfo {
  id: string
  email: string
  role: string
  token: string
  workspace_name: string
  invited_by: string
  expires_at: string
  created_at: string
}

export interface AcceptInviteResponse {
  message: string
  workspace_id: string
  workspace_name: string
  role?: string
  invited_by?: string
}

export interface InvitePreview {
  workspace_name: string
  invited_by: string
  role: string
  expires_at: string
}

export interface FileVersion {
  id: string
  version_number: number
  size_bytes: number
  chunk_count: number
  created_by: string | null
  created_at: string
}

export interface VersionSetting {
  id: string
  scope: string
  target_id: string | null
  enabled: boolean
  max_versions: number | null
  retention_days: number | null
}

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  read: boolean
  created_at: string
}

export interface Session {
  id: string
  is_current: boolean
  created_at: string
  expires_at: string
}

export interface ImpersonateResponse {
  session_token: string
  user_id: string
  email: string
}

export interface RoleChangeResponse {
  message: string
  user_id: string
  role: 'user' | 'admin' | 'superadmin'
}

export interface AdminStatsStorageByPlan {
  plan: string
  users: number
  used_bytes: number
}

export interface AdminStatsRevenuePlan {
  plan: string
  count: number
  price_cents?: number
  contribution_cents?: number
}

export interface AdminStats {
  users: {
    total: number
    active_7d: number
    active_30d?: number
    signups_today: number
    /** Daily signup counts for the last 7 days, oldest → today. */
    signups_last_7d?: number[]
    /** Three-letter weekday labels paired 1:1 with `signups_last_7d`. */
    signups_last_7d_labels?: string[]
  }
  files: {
    total: number
    storage_used_bytes: number
    uploads_today: number
  }
  shares: {
    active_links: number
    active_invites: number
    created_today: number
  }
  storage?: {
    total_used_bytes?: number
    pool_count?: number
    total_files?: number
    total_folders?: number
    avg_file_size_bytes?: number
    storage_by_plan?: AdminStatsStorageByPlan[]
  }
  revenue?: {
    active_paying_users: number
    plan_breakdown: AdminStatsRevenuePlan[]
    estimated_mrr_cents: number
  }
  activity?: {
    uploads_today: number
    downloads_today: number
    shares_created_today: number
    api_errors_today: number
  }
  funnel?: {
    signups_7d: number
    completed_onboarding_7d: number
    onboarding_rate_pct: number
    first_upload_7d: number
    first_upload_rate_pct: number
    verified_email_7d: number
    plan_upgraded_7d: number
  }
}

export interface UpgradePressureUser {
  id: string
  email: string
  plan: string
  used_bytes: number
  bonus_bytes: number
  quota_bytes: number
  utilization_pct: number
}

export interface UpgradePressureResponse {
  users_near_limit: UpgradePressureUser[]
  total_at_risk: number
  summary: {
    free_at_risk: number
    basic_at_risk: number
    pro_at_risk: number
  }
}

export interface HealthWorkerItem {
  interval_secs: number
  last_run: string | null
  seconds_ago?: number | null
  status: string
}

export interface HealthResponse {
  status: string
  version: string
  uptime_seconds: number
  db: string
  blob_store?: string
  db_pool?: { active: number; idle: number; max: number; size: number }
  checks: {
    database: { status: string; latency_ms: number }
    blob_store: { status: string; pools: number }
  }
  background_workers?: {
    any_stale: boolean
    count: number
    items: Record<string, HealthWorkerItem>
  }
  websocket_connections?: number
  process_memory?: { rss_kb: number; rss_mb: number } | null
}

export interface AdminBillingStats {
  total_subscribers: number
  mrr_cents: number
  conversion_rate: number
  plan_distribution: {
    free: number
    personal: number
    pro: number
    data_hoarder: number
    // Legacy keys — may be absent on new servers
    team?: number
    business?: number
  }
  recent_invoices: Array<{
    id: string
    user_id: string
    amount_cents: number
    currency: string
    status: 'paid' | 'open' | 'void' | 'uncollectible'
    created_at: string
  }>
}

export interface AdminConfig {
  email: {
    provider: string | null
    configured: boolean
  }
  slack: {
    configured: boolean
    webhook_url_prefix: string | null
  }
  turnstile: {
    configured: boolean
    sitekey_prefix: string | null
  }
  /** Flat boolean: live billing is wired up (`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`). */
  stripe_configured?: boolean
  /** Flat boolean: webhook secret is set so signatures are verified instead of skipped. */
  stripe_webhook_configured?: boolean
}

export type AbuseReportStatus = 'pending' | 'reviewing' | 'actioned' | 'dismissed'

export interface AbuseReport {
  id: string
  share_token: string
  reporter_id: string | null
  reporter_ip: string | null
  reporter_email: string | null
  reason: string
  status: AbuseReportStatus
  admin_notes: string | null
  created_at: string
  resolved_at: string | null
}

export interface JoinTransferResponse {
  /** Sender's ephemeral X25519 public key, base64. */
  sender_pk: string
  /** One-time token the receiver presents on status / blob / ack. */
  download_token: string
}

export interface TransferStatus {
  status: 'waiting' | 'joined' | 'approved' | 'ready' | 'downloaded' | 'complete' | 'cancelled' | 'expired'
  receiver_pk?: string
  blob_size?: number
  /** Encrypted (with transfer_key) filename hint, base64. */
  file_name_hint?: string
}

export interface TransferProof {
  proof_id: string
  session_id: string
  sender_user_id?: string
  receiver_display_name: string | null
  file_name: string
  file_size_bytes: number
  sha256_hash: string
  created_at: string
}

export interface CspReport {
  id: string
  document_uri: string | null
  violated_directive: string | null
  blocked_uri: string | null
  source_file: string | null
  line_number: number | null
  created_at: string
}

export interface LoginIp {
  ip: string
  first_seen: string
  last_seen: string
}

export interface GrowthDataPoint {
  date: string
  value: number
}

export type LifecyclePhase =
  | 'active'
  | 'quiescing'
  | 'migrating'
  | 'drained'
  | 'deleted'

export type LifecycleOutcome =
  | 'in_progress'
  | 'aborted'
  | 'reverse_migrated'
  | 'archived'
  | 'completed_deleted'

export interface LifecycleRun {
  id: string
  pool_id: string
  target_pool_id: string
  started_by: string
  started_at: string
  current_phase: LifecyclePhase
  outcome: LifecycleOutcome
  terminated_at: string | null
}

export interface PoolInsights {
  used_bytes: number
  files_count: number
  users_with_files_count: number
  currently_active_users_count: number
  in_flight_uploads_count: number
  /** Rough estimate based on recent migration throughput; falls back to a
   *  static 50 MB/s baseline when no history data is available. */
  estimated_migration_seconds: number
}

export interface RunProgress {
  run: LifecycleRun
  /** 0..1 fraction of files migrated for this run. */
  phase_progress: number
  throughput_bytes_per_sec: number
  files_total: number
  files_migrated: number
  files_failed: number
  files_pending: number
  /** Remaining seconds at current throughput; 0 when complete. */
  eta_seconds: number
}

export interface RunFileEntry {
  file_id: string
  /** Encrypted filename — UI shows truncated UUID or raw ciphertext; not decryptable in admin context. */
  name_encrypted: string
  size_bytes: number
  status: 'pending' | 'copying' | 'verifying' | 'done' | 'failed' | string
  error: string | null
  started_at: string | null
  completed_at: string | null
}

export interface LifecycleRunEvent {
  /** DB sequence number — used as the since_id cursor for WS reconnect replay. */
  id: number
  type: string
  at: string
  // file event fields
  file_id?: string
  size_bytes?: number
  chunks?: number
  bytes_copied?: number
  chunks_copied?: number
  duration_ms?: number
  error?: string
  // throughput_sample fields
  bytes_per_sec?: number
  files_per_sec?: number
  // phase_changed fields
  from?: string
  to?: string
}

export interface OnboardingState {
  /** User has verified their recovery phrase. */
  phrase_verified: boolean
  /** Server has a welcome file record (onboarding step 6 complete). */
  welcome_file_exists: boolean
  /** User has uploaded at least one non-welcome file. */
  first_upload_done: boolean
  /** User has created at least one active share link. */
  first_share_done: boolean
}

export interface TrackingPreference {
  tracking_opted_in: boolean
  opted_in_at: string | null
  opted_out_at: string | null
}

export interface MySignIn {
  at: string
  ip_anonymized: string | null
  user_agent: string | null
  country_code: string | null
  success: boolean
}

export interface MySignInsResponse {
  opted_in: boolean
  sign_ins: MySignIn[]
}

export interface AdminSignIn {
  id: string
  at: string
  /** Anonymized per data minimization — last octet zeroed for IPv4. */
  ip_anonymized: string | null
  /** Parsed UA string, e.g. "Chrome 124 on macOS". */
  device: string | null
  country_code: string | null
  success: boolean
}

export interface AdminSignInsResponse {
  opted_in: boolean
  sign_ins: AdminSignIn[]
}

export interface AdminActivityEvent {
  id: string
  at: string
  event_type: 'file_uploaded' | 'file_deleted' | 'file_downloaded' | 'share_created' | 'share_revoked' | 'folder_created' | string
  description: string
}

export interface AdminActivityResponse {
  opted_in: boolean
  events: AdminActivityEvent[]
}

export interface MyActivityResponse {
  opted_in: boolean
  events: ActivityEvent[]
}

export interface NotificationPreferences {
  share_received: boolean
  storage_warning: boolean
  new_device_login: boolean
  backup_complete: boolean
}

export interface DataExportRequest {
  export_id: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | string
  estimated_seconds?: number
  /** Server returns `resumed: true` when an existing export job is reused
   * instead of creating a new one. When resumed, the response also carries
   * any already-populated status fields below. */
  resumed?: boolean
  file_count?: number
  total_bytes?: number
  download_url?: string
  expires_at?: string
}

export interface DataExportStatus {
  export_id: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | string
  file_count?: number
  total_bytes?: number
  download_url?: string
  expires_at?: string
}

export interface AvailableRegion {
  continent: string
  display_name: string
  city: string
  provider: string
  is_default: boolean
}

export interface RegionsResponse {
  regions: AvailableRegion[]
}

export interface UserRegionResponse {
  preferred_region: string | null
  regions: AvailableRegion[]
}

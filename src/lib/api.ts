import { setClientInfo, registerOnTokenCleared, setApiUrl } from '@beebeeb/shared'
import { API_URL, clearEmail } from './api-session'

export * from './api-session'
export * from './api-auth-opaque'
export * from './api-auth-confirm'
export * from './api-files'
export * from './api-account'
export * from './api-shares'
export * from './api-library'
export * from './api-payments'
export * from './api-folder-access'
export * from './api-passkeys'
export * from './api-transfers'
export * from './api-public'
export * from './api-folder-links'
export { listLegacyFolderKeys, upgradeSharedFolderCustody, type LegacyFolderKeyRow } from './api-shared-folder-keys'
export * from './api-flags'
export * from './api-billing'
export * from './api-storage-addons'
export * from './api-vault-escrow'
export * from './api-file-requests'
export * from './api-google-import'
export * from './api-support'


// Writer-provenance (task 1436): tags every request through the shared
// `request()` client so the server's `object_versions.created_by_client` /
// `created_by_client_version` columns are filled for web writes.
// `__APP_VERSION__` is the Vite `define` from package.json's version (see
// vite.config.ts), the same string shown in Settings → About — it only
// exists once Vite has processed the module, so `typeof` guards the many
// `bun test` unit tests that import this file directly (no Vite define step).
setApiUrl(API_URL)
setClientInfo('web', typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')
registerOnTokenCleared(() => {
  clearEmail()
})

export {
  ApiError,
  IncorrectPasswordError,
  SessionTooOldForConfirmationError,
  clearToken,
  clearLegacyBearer,
  getApiUrl,
  getToken,
  registerAccountDeletedHandler,
  registerConnectionStatusHandler,
  registerErrorNotifier,
  request,
  registerSessionExpiredHandler,
  resolveSessionToken,
  setToken,
} from '@beebeeb/shared'


export type {
  AbuseReport,
  AbuseReportStatus,
  AcceptInviteResponse,
  AccountActivity,
  AccountActivityEvent,
  AccountActivitySummary,
  AccountExport,
  AccountSession,
  ActivityEvent,
  ActivityResponse,
  AdminStats,
  AuditEvent,
  AuthSessionResponse,
  AuthUser,
  AvailableRegion,
  BillingUsage,
  ConnectionStatusHandler,
  CreateBundleShareRequest,
  CreateTokenParams,
  CreateTokenResponse,
  CreateWebhookResponse,
  DataExportRequest,
  DataExportStatus,
  DriveFile,
  ErrorNotifier,
  FileVersion,
  HealthResponse,
  HealthWorkerItem,
  ImpersonateResponse,
  InviteActivity,
  InviteInfo,
  InvitePreview,
  Invoice,
  JoinTransferResponse,
  LoginResult,
  MyActivityEvent,
  MyActivityResponse,
  MyShare,
  MySignIn,
  MySignInsResponse,
  Notification,
  NotificationChannel,
  NotificationPreferences,
  NotificationType,
  LegacyNotificationPreferences,
  SecurityNotificationType,
  OnboardingState,
  PasskeyInfo,
  PasskeyLoginStartResponse,
  PasskeyRegisterStartResponse,
  PaymentMethod,
  PendingInvite,
  PersonalAccessToken,
  Plan,
  ReferralEntry,
  ReferralStats,
  SecurityFactor,
  SecurityScore,
  Session,
  SessionExpiredHandler,
  ShareInfo,
  ShareInvite,
  ShareItem,
  ShareOptions,
  ShareStats,
  ShareView,
  SharedFileDownload,
  StorageUsage,
  StreamTokenResponse,
  SubmittedSyncOp,
  Subscription,
  SyncNode,
  SyncOp,
  SyncOpsResult,
  SyncSnapshot,
  TotpSetupResponse,
  TrackingPreference,
  TransferProof,
  TransferStatus,
  UploadAbandonResponse,
  UploadStatusResponse,
  UserRegionResponse,
  VersionSetting,
  Webhook,
  Workspace,
  WorkspaceMember,
  WorkspaceMemberDetail,
  WorkspaceMembersResponse,
} from '@beebeeb/shared'

export type { ActivityEncryptedNameSnapshot } from '@beebeeb/shared'
// Task 1037 — `GET /billing/subscription` → `account_state`.
export type { AccountState } from '@beebeeb/shared'

// ─── Task 1525: verify the email with a code BEFORE the account exists ────


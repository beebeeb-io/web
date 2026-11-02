// Shared API base infrastructure.
//
// What lives here: configuration (API URL), token storage, the authenticated
// `request()` helper, common errors, and notifier registration hooks. Each
// app (web, admin) wires its own concrete handlers at startup.
//
// What does NOT live here: any endpoint-specific function (signup, login,
// listFiles, …). Those stay in each app's local `api.ts` and are layered on
// top of `request()`.

export {
  setApiUrl,
  getApiUrl,
  setClientInfo,
  getClientInfo,
  provenanceHeaders,
  setExpectedUserProvider,
  expectedUserHeaders,
} from './config'
export {
  setTokenStorageKey,
  registerOnTokenCleared,
  getToken,
  setToken,
  clearToken,
  clearLegacyBearer,
} from './token'
export {
  registerErrorNotifier,
  registerSessionExpiredHandler,
  registerAccountDeletedHandler,
  registerAccountSuspendedHandler,
  registerConnectionStatusHandler,
  registerAccountMismatchHandler,
  markSessionConfirmed,
  clearSessionConfirmed,
  getAuthStamp,
  bumpAuthGeneration,
  setAuthIdentity,
  isCurrentAuthStamp,
} from './notifiers'
export type { AuthStamp } from './notifiers'
export { request, resolveSessionToken } from './request'
export type { ResolveSessionTokenDeps } from './request'
export {
  ApiError,
  IncorrectPasswordError,
  SessionTooOldForConfirmationError,
  parseErrorBody,
  readErrorResponse,
} from './errors'
export type { AbuseReport, AbuseReportStatus, AcceptInviteResponse, AccountActivity, AccountActivityEvent, AccountActivitySummary, AccountExport, AccountSession, AccountState, ActivityEncryptedNameSnapshot, ActivityEvent, ActivityResponse, AdminActivityEvent, AdminActivityResponse, AdminBillingStats, AdminConfig, AdminSignIn, AdminSignInsResponse, AdminStats, AdminStatsRevenuePlan, AdminStatsStorageByPlan, AdminUser, AdminUserDetail, AdminUserFile, AdminUserFilesResponse, AdminUserSession, AdminUsersResponse, AuditEvent, AuthSessionResponse, AuthUser, AvailableRegion, BillingUsage, ConnectionStatusHandler, CreateBundleShareRequest, CreateTokenParams, CreateTokenResponse, CreateWebhookResponse, CspReport, DataExportRequest, DataExportStatus, DownloadVersion, DownloadVersionChunk, DriveFile, ErrorNotifier, FileVersion, GrowthDataPoint, HealthResponse, HealthWorkerItem, ImpersonateResponse, InviteActivity, InviteInfo, InvitePreview, Invoice, JoinTransferResponse, LastTrial, LegacyNotificationPreferences, LifecycleOutcome, LifecyclePhase, LifecycleRun, LifecycleRunEvent, LoginIp, LoginResult, MigrationEntry, MigrationSummary, MyActivityEvent, MyActivityResponse, MyShare, MySignIn, MySignInsResponse, Notification, NotificationChannel, NotificationPreferences, NotificationType, OnboardingState, PasskeyInfo, PasskeyLoginStartResponse, PasskeyRegisterStartResponse, PaymentMethod, PendingInvite, PersonalAccessToken, Plan, PoolInsights, PoolUsageEntry, ReferralEntry, ReferralStats, RoleChangeResponse, RunFileEntry, RunProgress, SecurityFactor, SecurityNotificationType, SecurityScore, Session, SessionExpiredHandler, ShareInfo, ShareInvite, ShareItem, ShareOptions, ShareStats, ShareType, ShareView, SharedFileDownload, SignupResult, StoragePool, StorageUsage, StreamTokenResponse, SubmittedSyncOp, Subscription, SyncNode, SyncOp, SyncOpsResult, SyncSnapshot, TotpSetupResponse, TrackingPreference, TransferProof, TransferStatus, UpgradePressureResponse, UpgradePressureUser, UploadAbandonResponse, UploadStatusResponse, UserRegionResponse, UserStorageBreakdown, UserStoragePoolEntry, VersionSetting, WaitlistEntry, WaitlistResponse, Webhook, Workspace, WorkspaceMember, WorkspaceMemberDetail, WorkspaceMembersResponse } from '../types'

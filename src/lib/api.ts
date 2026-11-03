// The web API facade: one named re-export per endpoint module, no endpoint logic here.
import { setClientInfo, registerOnTokenCleared, setApiUrl } from '@beebeeb/shared'
import { API_URL, clearEmail } from './api-session'
export { API_URL, STATUS_URL, clearEmail, getEmail, hexToBytes, setEmail } from './api-session'
export { CAPABILITIES_HEADER, RESET_2FA_CAPABILITY, login, logout, opaqueLoginFinish, opaqueLoginStart, opaqueRegisterFinish, opaqueRegisterFinishExisting, opaqueRegisterStart, opaqueRegisterStartExisting, recoverOpaqueRegister, recoverWithPhraseFinalize, recoverWithPhraseStart, setRecoveryCheckIfAbsent, signupEmailStart, signupEmailVerify, verifyRecoveryCheck } from './api-auth-opaque'
export type { ResetFinalizeResult } from './api-auth-opaque'
export { confirmAction, confirmPasskey, disable2fa, enable2fa, getMe, resendVerification, setup2fa, stepUpGrantFields, unlockAccount, verify2fa, verifyEmail } from './api-auth-confirm'
export type { StepUpGrant } from './api-auth-confirm'
export { FILE_LIST_HARD_CAP, abandonUpload, bulkPermanentDelete, bulkTrashFiles, completeUpload, createFolder, deleteFile, downloadFile, getFile, getSnapshot, getStreamToken, getSyncOps, getSyncOpsSinceUserSeq, getUploadStatus, initUpload, listAllFiles, listFiles, listFilesPage, permanentDeleteFile, restoreFile, submitSyncOps, toggleStar, updateFile, uploadChunk, uploadThumbnail, uploadThumbnailLarge } from './api-files'
export type { RestoreFileResult, UploadInitResponse, UserSeqSyncOp, UserSeqSyncOpsPage, UserSeqSyncSnapshot } from './api-files'
export { cancelEraseRequest, changeEmail, changePasswordOpaqueFinish, changePasswordOpaqueStart, createEraseRequest, deleteAccountPermanently, emailChangeFinish, emailChangeStart, forgotPassword, getEraseRequest, resetPassword, restoreEraseRequest, setPasswordFinalize, setPasswordOpaqueRegister } from './api-account'
export { approveInvite, cancelInvite, claimInvite, createBundleShare, createInvite, createShare, denyInvite, downloadBundleItem, downloadSharedFile, fetchShareCiphertextPreview, getIncomingInvites, getInviteActivity, getPendingApprovals, getSentInvites, getShare, getShareStats, getSharesForFile, hideInvite, listMyShares, listSharingContacts, patchInvite, resendInvite, resolveSharingContact, revokeShare, verifySharePassphrase, withdrawInvite } from './api-shares'
export type { SharingContact } from './api-shares'
export { fetchUsage, getAllImages, getMediaFiles, getPlans, getStorageUsage } from './api-library'
export { getAvailableMethods, getCoupon, getInvoices, getPaymentStatus, getSubscription, redeemCoupon, subscribe, validatePromo } from './api-payments'
export type { OfferedMethod, PaymentStatusResult, PromoQuote, PromoValidation } from './api-payments'
export { addFolderKeys, getFolderKeys, getFolderMembers, getPreference, getPreferences, listSharedFolderFiles, setPreference } from './api-folder-access'
export { base64urlToBuffer, bufferToBase64url, credentialToAuthenticationJSON, credentialToRegistrationJSON, deletePasskey, finishPasskeyLogin, finishPasskeyRegistration, listPasskeys, serverOptsToCreateOptions, serverOptsToGetOptions, startPasskeyLogin, startPasskeyRegistration } from './api-passkeys'
export { ackTransfer, createTransferProof, downloadTransferBlob, getTransferStatus, joinTransfer, joinTransferByCode, reportShareLink } from './api-transfers'
export { getActiveIncidents, getMyProfile, getPublicProfile, listAnnouncements, updatePublicProfile } from './api-public'
export type { ActiveIncident, Announcement, AnnouncementSeverity, IncidentUpdate, PublicProfile, PublicProfileShare } from './api-public'
export { adoptOwnerFileKey, createFolderLink, getSharedFolder, getSharedFolderActivity, listFolderLinks, listSharedFolderKeys, publishSharedFolderKeys, registerSharedFolderKey, revokeFolderLink, updateFolderLink } from './api-folder-links'
export type { SharedFolderInfo } from './api-folder-links'
export { listLegacyFolderKeys, upgradeSharedFolderCustody, type LegacyFolderKeyRow } from './api-shared-folder-keys'
export { getEvaluateFlags } from './api-flags'
export { cancelDowngrade, cancelSubscription, convertTrial, createCheckoutSession, downgradePlan, downloadCreditNotePdf, downloadInvoicePdf, exportBillingTransactions, getBillingCreditNotes, getBillingInvoices, getBillingProfile, getBillingTransactions, getPaymentMethod, getVatPreview, mapBillingCreditNotes, pauseSubscription, payTrialNow, reactivateSubscription, resumeSubscription, saveBillingProfile, startNoCardTrial, startTrialCheckout, switchBillingCycle, updatePaymentMethod } from './api-billing'
export type { BillingCreditNote, BillingInvoice, BillingProfile, BillingProfilePayload, BillingTransaction, CheckoutResult, CheckoutSuccess, CheckoutTrialResult, CompanyRegistrationType, CustomerType, NoCardTrialStarted, RawBillingCreditNote, TrialCheckoutMethod, TrialCheckoutResult, TrialPayNowResult, VatPreview, VatState, VatTreatment, ZeroPriceActivation } from './api-billing'
export { createStorageAddonCheckout, createToken, createWebhook, deleteWebhook, enableWebhook, getReferralStats, getStorageAddons, listAuditLog, listReferrals, listTokens, listWebhooks, normalizeStorageAddonState, payOverdue, previewStorageAddons, revokeToken, testWebhook, updateStorageAddons } from './api-storage-addons'
export type { StorageAddonPreview, StorageAddonState } from './api-storage-addons'
export { acceptWorkspaceInvite, createWorkspace, deleteClientDevice, deleteClientSession, deleteNotification, deleteVersion, downloadVersion, getAccountActivity, getAccountSessions, getHealth, getInvitePreview, getSecurityScore, getVaultKeyEscrow, getVersionSettings, inviteWorkspaceMember, listActivity, listClientDevices, listClientSessions, listNotifications, listSessions, listVersions, listWorkspaceMembers, listWorkspaces, markAllNotificationsRead, markNotificationRead, redeemImpersonationToken, removeWorkspaceMember, requestAdminHandoff, restoreVersion, revokeAccountSession, revokeAllOtherSessions, revokeSession, setDeviceNotifications, setVersionSetting, storeVaultKeyEscrow, updateMemberRole } from './api-vault-escrow'
export type { AdminHandoffResponse, ClientDevice, ClientSession, ImpersonationRedeemResponse, VersionList, VersionListItem } from './api-vault-escrow'
export { closeFileRequest, createFileRequest, getFileRequestPublic, listFileRequests, uploadToFileRequest } from './api-file-requests'
export type { CreateFileRequestParams, CreateFileRequestResult, FileRequest, FileRequestPublic } from './api-file-requests'
export { devResetOnboarding, freezeAccount, getDataExportStatus, getMyActivity, getMySignIns, getNotificationPreferences, getOnboardingState, getTrackingPreference, getUserRegion, googleTokenExchange, googleTokenRefresh, markWelcomeFile, requestDataExport, setNotificationPreferences, setTrackingPreference, setUserRegion, unfreezeAccount } from './api-google-import'
export type { UserRegionData } from './api-google-import'
export { createSupportTicket, getSupportTicket, listSupportTickets, replyToSupportTicket } from './api-support'
export type { SupportTicket, SupportTicketDetail, SupportTicketMessage, SupportTicketStatus } from './api-support'
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


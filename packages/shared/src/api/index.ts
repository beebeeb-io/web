// Shared API base infrastructure.
//
// What lives here: configuration (API URL), token storage, the authenticated
// `request()` helper, common errors, and notifier registration hooks. Each
// app (web, admin) wires its own concrete handlers at startup.
//
// What does NOT live here: any endpoint-specific function (signup, login,
// listFiles, …). Those stay in each app's local `api.ts` and are layered on
// top of `request()`.

export { setApiUrl, getApiUrl } from './config'
export {
  setTokenStorageKey,
  registerOnTokenCleared,
  getToken,
  setToken,
  clearToken,
} from './token'
export {
  registerErrorNotifier,
  registerSessionExpiredHandler,
  registerConnectionStatusHandler,
} from './notifiers'
export { request } from './request'
export {
  ApiError,
  IncorrectPasswordError,
  SessionTooOldForConfirmationError,
} from './errors'
export * from '../types'

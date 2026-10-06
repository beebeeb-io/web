/**
 * Whether the URL says the user just came back from a hosted checkout.
 *
 * Only `?upgraded=true` and `?session_id=` (what our server's checkout return URLs and the
 * provider emit). A bare `?success=true` is NOT a return: nothing links with it (task 1828),
 * and honouring it let a crafted link show a false "subscription is now active". Even a real
 * return only ever starts a poll — the page claims success after the subscription changes.
 */
export function isCheckoutReturn(params: URLSearchParams): boolean {
  return params.get('upgraded') === 'true' || Boolean(params.get('session_id'))
}

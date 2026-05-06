import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { type AcceptInviteResponse, ApiError, acceptWorkspaceInvite } from '../lib/api'

type InviteState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'accepted'; data: AcceptInviteResponse }
  | { kind: 'error'; message: string }

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<InviteState>({ kind: 'loading' })
  const [accepting, setAccepting] = useState(false)

  // If not logged in, redirect to signup with a return URL
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate(`/signup?redirect=/invite/${token}`, { replace: true })
      return
    }
    // User is logged in — show the accept UI
    setState({ kind: 'ready' })
  }, [authLoading, user, token, navigate])

  const handleAccept = async () => {
    if (!token) return
    setAccepting(true)
    try {
      const result = await acceptWorkspaceInvite(token)
      setState({ kind: 'accepted', data: result })
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : 'Something went wrong. The invite may have expired.'
      setState({ kind: 'error', message })
    } finally {
      setAccepting(false)
    }
  }

  if (authLoading || state.kind === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="text-sm text-ink-3">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <div
        className="bg-paper rounded-xl border border-line-2 shadow-2 overflow-hidden"
        style={{ width: 520 }}
      >
        {/* Header */}
        <div className="px-6 py-6 border-b border-line text-center">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div
              className="w-10 h-10 rounded-[10px] flex items-center justify-center border"
              style={{
                background: 'var(--color-amber-bg)',
                borderColor: 'var(--color-amber-deep)',
              }}
            >
              <BBLogo size={14} />
            </div>
            <span className="text-[22px] leading-none text-ink-3">&#8594;</span>
            <div className="w-10 h-10 rounded-[10px] bg-paper-2 border border-line-2 flex items-center justify-center text-[13px] font-bold text-ink-2">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
          </div>

          {state.kind === 'accepted' ? (
            <>
              <h2 className="text-lg font-semibold text-ink">
                Welcome to{' '}
                <span className="text-amber-deep">
                  {state.data.workspace_name}
                </span>
              </h2>
              <p className="text-[13px] text-ink-2 mt-1.5">
                You have joined the workspace
                {state.data.role ? ` as ${state.data.role}` : ''}.
              </p>
            </>
          ) : state.kind === 'error' ? (
            <>
              <h2 className="text-lg font-semibold text-ink">Invite issue</h2>
              <p className="text-[13px] text-ink-2 mt-1.5">{state.message}</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink">
                You have been invited to a workspace
              </h2>
              <p className="text-[13px] text-ink-2 mt-1.5">
                Accept the invite to join and start collaborating.
              </p>
            </>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Signed-in indicator */}
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Sign in as
          </div>
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border mb-4"
            style={{
              borderColor: 'var(--color-amber-deep)',
              background: 'var(--color-amber-bg)',
            }}
          >
            <div className="w-6.5 h-6.5 rounded-full bg-ink text-paper flex items-center justify-center text-[10px] font-bold shrink-0">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-ink truncate">
                {user?.email}
              </div>
              <div className="font-mono text-[11px] text-ink-3">
                Already signed in
              </div>
            </div>
            <BBChip variant="green">Zero-knowledge</BBChip>
          </div>

          {/* Action */}
          {state.kind === 'accepted' ? (
            <BBButton
              variant="amber"
              size="lg"
              className="w-full justify-center"
              onClick={() => navigate('/')}
            >
              Go to your drive
            </BBButton>
          ) : state.kind === 'error' ? (
            <BBButton
              variant="default"
              size="lg"
              className="w-full justify-center"
              onClick={() => navigate('/')}
            >
              Go to your drive
            </BBButton>
          ) : (
            <BBButton
              variant="amber"
              size="lg"
              className="w-full justify-center"
              onClick={handleAccept}
              disabled={accepting}
            >
              <Icon name="users" size={13} className="mr-2" />
              {accepting ? 'Joining...' : 'Accept invite'}
            </BBButton>
          )}

          {state.kind === 'ready' && (
            <div className="text-center mt-2.5">
              <span className="text-[11px] text-ink-3">
                Or{' '}
                <button
                  type="button"
                  onClick={() => navigate('/signup')}
                  className="text-amber-deep hover:underline cursor-pointer"
                >
                  create a new Beebeeb account
                </button>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

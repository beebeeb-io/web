import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'

// ─── Types ────────────────────────────────────────

export interface Toast {
  id: string
  icon: IconName
  title: string
  description?: string
  href?: string
  danger?: boolean
  onUndo?: () => void
}

interface ToastState {
  showToast: (toast: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastState | null>(null)

export function useToast(): ToastState {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

// ─── Provider ─────────────────────────────────────

const AUTO_DISMISS_MS = 5_000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    counterRef.current += 1
    const id = `toast-${counterRef.current}-${Date.now()}`
    setToasts((prev) => [...prev, { ...toast, id }])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container — top-right */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ─── Individual toast ─────────────────────────────

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: string) => void
}) {
  const [entering, setEntering] = useState(true)
  const [exiting, setExiting] = useState(false)
  const hoveredRef = useRef(false)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startExit = useCallback(() => {
    setExiting(true)
    setTimeout(() => onDismiss(toast.id), 200)
  }, [toast.id, onDismiss])

  const scheduleDismiss = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = setTimeout(() => {
      if (!hoveredRef.current) startExit()
    }, AUTO_DISMISS_MS)
  }, [startExit])

  useEffect(() => {
    // Trigger enter animation
    const enterTimer = requestAnimationFrame(() => setEntering(false))
    scheduleDismiss()

    return () => {
      cancelAnimationFrame(enterTimer)
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [scheduleDismiss])

  const handleMouseEnter = () => {
    hoveredRef.current = true
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
  }

  const handleMouseLeave = () => {
    hoveredRef.current = false
    scheduleDismiss()
  }

  const handleClick = () => {
    if (toast.href) {
      window.location.href = toast.href
    }
    startExit()
  }

  const handleUndo = (e: React.MouseEvent) => {
    e.stopPropagation()
    toast.onUndo?.()
    startExit()
  }

  return (
    <div
      role="alert"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`pointer-events-auto w-[360px] bg-paper border border-line-2 rounded-lg overflow-hidden transition-all duration-200 ${
        toast.href ? 'cursor-pointer' : ''
      }`}
      style={{
        boxShadow: '0 12px 32px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.04)',
        transform: entering
          ? 'translateX(120%)'
          : exiting
            ? 'translateX(120%)'
            : 'translateX(0)',
        opacity: exiting ? 0 : 1,
      }}
    >
      <div className="flex items-start gap-2.5 p-3">
        {/* Icon */}
        <div
          className={`shrink-0 w-[26px] h-[26px] rounded-[7px] flex items-center justify-center border ${
            toast.danger
              ? 'bg-red/10 border-red/30'
              : 'bg-paper-2 border-line'
          }`}
        >
          <Icon
            name={toast.icon}
            size={11}
            className={toast.danger ? 'text-red' : 'text-ink-2'}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-snug">{toast.title}</div>
          {toast.description && (
            <div className="text-[10.5px] text-ink-3 mt-0.5 leading-snug">
              {toast.description}
            </div>
          )}
        </div>

        {/* Undo button */}
        {toast.onUndo && (
          <button
            onClick={handleUndo}
            className="shrink-0 text-[11px] font-semibold text-amber-deep hover:text-amber transition-colors px-1.5 py-0.5 rounded hover:bg-amber-bg"
          >
            Undo
          </button>
        )}

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            startExit()
          }}
          className="shrink-0 p-0.5 text-ink-4 hover:text-ink-2 transition-colors"
          aria-label="Dismiss"
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  )
}

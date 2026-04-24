import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { BBLogo } from './bb-logo'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console now; Sentry integration later
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV

      return (
        <div className="min-h-screen bg-paper flex items-center justify-center p-xl">
          <div className="max-w-[400px] w-full text-center">
            <div className="mb-xl">
              <BBLogo size={28} />
            </div>

            <h1 className="text-lg font-semibold text-ink mb-sm">
              Something went wrong
            </h1>

            <p className="text-sm text-ink-3 mb-lg">
              An unexpected error occurred. Please reload the page and try again.
            </p>

            {isDev && this.state.error && (
              <div className="mb-lg text-left bg-paper-2 border border-line rounded-md p-md">
                <p className="text-[11px] font-mono text-red break-all leading-relaxed">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="inline-flex items-center justify-center h-9 px-lg bg-ink text-paper text-sm font-medium rounded-md hover:bg-ink-2 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

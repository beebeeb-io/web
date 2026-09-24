import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { reportError } from '@beebeeb/shared'
import { ServerError } from '../pages/errors/server-error'

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
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
    reportError(error, { boundary: 'react', componentStack: info.componentStack ?? '' })
  }

  render() {
    if (this.state.hasError) {
      return <ServerError error={this.state.error} />
    }

    return this.props.children
  }
}

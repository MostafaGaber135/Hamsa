import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '@/lib/monitoring'

interface ErrorBoundaryProps {
  /** Shown instead of the children once they have thrown while rendering. */
  fallback: ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Contains a rendering error to the part of the screen that caused it,
 * so one bad piece of data can't blank out the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    reportError(error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback: ReactNode
}
interface State {
  hasError: boolean
}

/**
 * Minimal error boundary — keeps a misbehaving subtree (e.g. the camera
 * scanner on an unsupported device/browser) from crashing the whole page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch() {
    // Intentionally swallowed — the fallback UI is shown instead.
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

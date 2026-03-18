import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  errorMessage: string | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      errorMessage: null,
    }
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'The clinical workspace hit an unexpected error.',
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React render error', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: null })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="app-error-boundary-shell">
        <section className="hero-card app-error-boundary-card">
          <p className="shell-eyebrow">Application error</p>
          <h3>The workspace needs to recover</h3>
          <p>
            An unexpected screen error interrupted the current view. Try the workspace again, or reload if the problem persists.
          </p>
          {this.state.errorMessage ? (
            <div className="error-banner">{this.state.errorMessage}</div>
          ) : null}
          <div className="action-row app-error-boundary-actions">
            <button type="button" className="primary-button" onClick={this.handleReset}>
              Try again
            </button>
            <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </section>
      </div>
    )
  }
}
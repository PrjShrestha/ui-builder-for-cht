/**
 * Error boundary for the editor's main view. Pre-fix, a single component
 * throw (e.g. the ReportFieldPicker infinite-loop crash class) propagated
 * up to React's root and white-screened the whole app — the sidebar
 * disappeared too, leaving the user with no way to navigate out except
 * a hard reload. That's a hostile UX for an in-progress edit.
 *
 * Now: the boundary catches the throw, shows a clear "this panel
 * crashed" fallback with the error message + a reset button, and
 * keeps the sidebar mounted so the user can switch to another view.
 * The boundary's `resetKey` prop (current view kind/id) means
 * navigating away auto-clears the error without a manual click.
 *
 * Why a class component? React's `componentDidCatch` /
 * `getDerivedStateFromError` hooks ARE the only way to catch render
 * errors from child components. The function-component `useErrorBoundary`
 * proposals haven't landed in stable React.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** When this changes, the boundary clears any prior error state. Pass
   *  the current view identifier so route-changes reset the boundary. */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-undef
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  override componentDidUpdate(prev: Props): void {
    if (
      this.state.error &&
      prev.resetKey !== undefined &&
      this.props.resetKey !== prev.resetKey
    ) {
      this.setState({ error: null, componentStack: null });
    }
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary-fallback" role="alert">
        <h2>This panel crashed.</h2>
        <p className="muted">
          The editor caught the error so the rest of the app stays usable.
          Switch to another view in the sidebar, or click <strong>Reset</strong>{' '}
          below to retry this one.
        </p>
        <pre className="error-boundary-message">{this.state.error.message}</pre>
        {this.state.componentStack && (
          <details>
            <summary className="muted">Component stack (for the dev tools)</summary>
            <pre className="error-boundary-stack">{this.state.componentStack}</pre>
          </details>
        )}
        <div className="row gap">
          <button onClick={this.reset}>Reset</button>
          {/* eslint-disable-next-line no-undef */}
          <button className="link" onClick={() => window.location.reload()}>
            Hard reload the app
          </button>
        </div>
      </div>
    );
  }
}

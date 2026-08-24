import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RootErrorBoundaryProps {
  readonly children: ReactNode;
}

interface RootErrorBoundaryState {
  readonly failed: boolean;
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  private readonly children: ReactNode;

  constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.children = props.children;
  }

  state: RootErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dashboard rendering failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.children;
    return (
      <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '3rem 1.5rem', background: '#0f1115', color: '#fbbf24', font: '600 14px/1.5 monospace', textAlign: 'center' }}>
        <p>The Dashboard could not finish loading.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '.6rem 1rem', border: '1px solid #fbbf24', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>Retry</button>
      </main>
    );
  }
}
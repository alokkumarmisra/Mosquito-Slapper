import { Component, ErrorInfo, ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { FirestoreErrorInfo } from '../firebase';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  details: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
    details: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || 'An unexpected error occurred.';
    let details: string | null = null;

    try {
      const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
      if (parsed && typeof parsed.error === 'string' && parsed.operationType) {
        message = parsed.error.includes('Quota exceeded')
          ? 'Cloud sync quota reached for today. Reload to continue playing in Guest Mode.'
          : 'A cloud sync permission or connection error occurred. Reload to continue playing.';
        details = `${parsed.operationType.toUpperCase()} ${parsed.path ?? ''} — ${parsed.error}`;
      }
    } catch {
      // Standard non-JSON runtime error
    }

    return {
      hasError: true,
      message,
      details,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App ErrorBoundary caught error:', error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, message: '', details: null });
    window.location.reload();
  };

  handleRecover = (): void => {
    this.setState({ hasError: false, message: '', details: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#0E1310] p-4 text-[#F4F7F2]">
        <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#121814] p-6 shadow-2xl">
          <h1 className="font-display text-xl font-extrabold text-[#F4F7F2]">
            Something Interrupted the Arena
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{this.state.message}</p>
          {this.state.details && (
            <p className="mt-3 rounded-lg border border-white/8 bg-[#18201B] p-2.5 font-mono text-[11px] break-words text-slate-400">
              {this.state.details}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-white/12 bg-[#1A221D] px-4 text-xs font-semibold text-slate-200 hover:bg-[#242F28] whitespace-nowrap cursor-pointer"
            >
              Continue as Guest
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] hover:bg-[#d7fb6a] whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Reload Game
            </button>
          </div>
        </div>
      </div>
    );
  }
}

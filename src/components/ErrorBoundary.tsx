import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] w-full flex items-center justify-center p-6 bg-[#FFF5FA]">
          <div className="max-w-md w-full bg-white rounded-3xl border-2 border-rose-200 p-6 shadow-[6px_6px_0px_0px_rgba(225,29,72,0.1)] text-center space-y-4 font-body">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-display font-black text-slate-900">Something went wrong</h2>
              <p className="text-xs text-slate-500">
                An unexpected error occurred while rendering this page.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-left space-y-2">
                <p className="text-[11px] font-mono text-slate-700 font-semibold break-words">
                  {this.state.error.name ? `${this.state.error.name}: ` : ''}{this.state.error.message}
                </p>
                {this.state.error.stack && (
                  <pre className="text-[9px] font-mono text-slate-500 overflow-x-auto max-h-24 whitespace-pre-wrap">
                    {this.state.error.stack.split('\n').slice(0, 4).join('\n')}
                  </pre>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const text = `${this.state.error?.name || 'Error'}: ${this.state.error?.message}\n${this.state.error?.stack || ''}`;
                    navigator.clipboard?.writeText(text);
                    alert('Error copied to clipboard!');
                  }}
                  className="text-[10px] text-pink-600 font-semibold underline cursor-pointer"
                >
                  Copy Error Details
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={this.handleReset}
                className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5 text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if ('caches' in window) {
                    caches.keys().then(names => names.forEach(name => caches.delete(name)));
                  }
                  window.location.reload();
                }}
                className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5 text-xs"
              >
                Hard Reload
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  window.location.href = '/finance/budget';
                }}
                className="rounded-xl bg-[#FF2EB8] hover:bg-[#E026A2] text-white gap-1.5 text-xs"
              >
                <Home className="w-3.5 h-3.5" /> Go to Budget
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

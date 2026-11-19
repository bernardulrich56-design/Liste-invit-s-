import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Une erreur inattendue s'est produite.",
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('React ErrorBoundary caught error:', error, info);
  }

  private handleGoHome = () => {
    try {
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.searchParams.delete('tab');
      url.hash = '';
      window.location.assign(url.toString());
    } catch {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#DCE4EE] flex items-center justify-center p-4 text-slate-900">
        <div className="max-w-lg w-full bg-white border border-slate-300 rounded-2xl p-6 sm:p-8 shadow-lg space-y-5">
          <div className="w-12 h-12 rounded-xl bg-orange-100 border border-orange-200 text-orange-700 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
              Affichage temporairement interrompu
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Une erreur d&apos;interface s&apos;est produite sur cette page. Vos
              données enregistrées sur Firebase sont en sécurité.
            </p>
          </div>

          {this.state.errorMessage && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-700 break-words">
              {this.state.errorMessage}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Recharger l&apos;application
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold transition-colors"
            >
              <Home className="w-4 h-4" />
              Retour à l&apos;accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}

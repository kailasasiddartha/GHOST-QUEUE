import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("App crashed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-white flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-8 text-center">
            <span className="material-symbols-outlined text-5xl text-error">error</span>
            <h1 className="mt-4 text-2xl font-headline font-bold">Something went wrong</h1>
            <p className="mt-3 text-sm text-on-surface-variant">The app hit an unexpected error. Reload to continue.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-3 font-headline font-bold text-white"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

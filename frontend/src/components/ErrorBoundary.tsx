import React, { Component } from 'react';

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="relative z-10 flex items-center justify-center min-h-[60vh]">
                    <div className="flex flex-col items-center gap-6 max-w-md text-center px-4">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
                            <p className="text-sm text-gray-400 mb-1">
                                Failed to load this page. This might be a temporary network issue.
                            </p>
                            {this.state.error && (
                                <p className="text-xs text-gray-500 font-mono mt-2 bg-gray-900/50 rounded-lg p-3 border border-gray-800 break-all">
                                    {this.state.error.message}
                                </p>
                            )}
                        </div>
                        <button
                            onClick={this.handleRetry}
                            className="px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-100 transition-colors"
                        >
                            Try again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
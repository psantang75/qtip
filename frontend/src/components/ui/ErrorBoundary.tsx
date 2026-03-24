// @ts-nocheck
import React, { Component, ReactNode } from 'react';
import { HiOutlineExclamationCircle, HiOutlineRefresh } from 'react-icons/hi';
import Button from './Button';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: any) => void;
}

interface Props extends ErrorBoundaryProps {}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string;
  retryCount: number;
}

class ErrorBoundary extends Component<Props, State> {
  private maxRetries = 3;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: '',
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return {
      hasError: true,
      error,
      errorId
    };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // Log error to console in development
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error);
      console.error('Error info:', errorInfo);
    }

    // Log error to external service in production
    if (import.meta.env.PROD) {
      this.logErrorToService(error, errorInfo);
    }

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  private logErrorToService = (error: Error, errorInfo: any) => {
    // This would be replaced with actual error logging service
    const errorReport = {
      errorId: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: this.getCurrentUserId()
    };

    // Send to error tracking service (e.g., Sentry, LogRocket, etc.)
    console.error('Production Error Report:', errorReport);
  };

  private getCurrentUserId = (): string | null => {
    try {
      const user = localStorage.getItem('user');
      return user ? JSON.parse(user).id : null;
    } catch {
      return null;
    }
  };

  private handleRetry = () => {
    if (this.state.retryCount < this.maxRetries) {
      this.setState(prevState => ({
        hasError: false,
        error: null,
        errorId: '',
        retryCount: prevState.retryCount + 1
      }));
    } else {
      // Max retries reached, reload page
      window.location.reload();
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center">
              <HiOutlineExclamationCircle className="mx-auto h-16 w-16 text-red-500" />
              <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
                Something went wrong
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                We apologize for the inconvenience. An unexpected error has occurred.
              </p>
              
              {import.meta.env.DEV && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md text-left">
                  <p className="text-sm font-medium text-red-800">
                    Error ID: {this.state.errorId}
                  </p>
                  <p className="text-xs text-red-600 mt-2">
                    {this.state.error?.message}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {this.state.retryCount < this.maxRetries ? (
                <Button
                  onClick={this.handleRetry}
                  className="w-full flex justify-center items-center"
                  variant="primary"
                >
                  <HiOutlineRefresh className="mr-2 h-4 w-4" />
                  Try Again ({this.maxRetries - this.state.retryCount} attempts left)
                </Button>
              ) : (
                <Button
                  onClick={this.handleReload}
                  className="w-full flex justify-center items-center"
                  variant="primary"
                >
                  <HiOutlineRefresh className="mr-2 h-4 w-4" />
                  Reload Page
                </Button>
              )}

              <Button
                onClick={this.handleGoHome}
                className="w-full"
                variant="secondary"
              >
                Go to Home
              </Button>

              <div className="text-center">
                <p className="text-xs text-gray-500">
                  If the problem persists, please contact support with error ID: {this.state.errorId}
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary; 
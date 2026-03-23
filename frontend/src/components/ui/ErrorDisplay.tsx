import React from 'react';
import { cn } from '../../utils/cn';
import Button from './Button';

export interface ErrorDisplayProps {
  title?: string;
  message: string;
  variant?: 'inline' | 'card' | 'page';
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  title = 'Error',
  message,
  variant = 'inline',
  size = 'md',
  showIcon = true,
  actionLabel,
  onAction,
  className,
  dismissible = false,
  onDismiss
}) => {
  const baseClasses = [
    'text-danger'
  ];

  const variants = {
    inline: [
      'flex items-start space-x-2'
    ],
    card: [
      'bg-red-50 border border-red-200 rounded-lg p-4'
    ],
    page: [
      'text-center py-12 px-4'
    ]
  };

  const sizes = {
    sm: {
      text: 'text-sm',
      title: 'text-base font-medium',
      icon: 'h-4 w-4',
      spacing: 'space-y-1'
    },
    md: {
      text: 'text-base',
      title: 'text-lg font-semibold',
      icon: 'h-5 w-5',
      spacing: 'space-y-2'
    },
    lg: {
      text: 'text-lg',
      title: 'text-xl font-bold',
      icon: 'h-6 w-6',
      spacing: 'space-y-3'
    }
  };

  const containerClasses = cn(
    baseClasses,
    variants[variant],
    sizes[size].spacing,
    className
  );

  const ErrorIcon = () => (
    <svg 
      className={cn('flex-shrink-0', sizes[size].icon)}
      fill="none" 
      stroke="currentColor" 
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        strokeWidth={2} 
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
      />
    </svg>
  );

  const CloseIcon = () => (
    <svg 
      className="h-4 w-4" 
      fill="none" 
      stroke="currentColor" 
      viewBox="0 0 24 24"
    >
      <path 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        strokeWidth={2} 
        d="M6 18L18 6M6 6l12 12" 
      />
    </svg>
  );

  if (variant === 'inline') {
    return (
      <div className={containerClasses}>
        {showIcon && <ErrorIcon />}
        <div className="flex-1">
          {title && title !== 'Error' && (
            <p className={cn(sizes[size].title, 'text-danger')}>{title}</p>
          )}
          <p className={cn(sizes[size].text, 'text-danger')}>{message}</p>
          {onAction && actionLabel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAction}
              className="mt-2 text-danger hover:text-red-700 p-0 h-auto"
            >
              {actionLabel}
            </Button>
          )}
        </div>
        {dismissible && onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 text-danger hover:text-red-700 transition-colors"
            aria-label="Dismiss error"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={containerClasses}>
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            {showIcon && <ErrorIcon />}
            <div>
              <h3 className={cn(sizes[size].title, 'text-danger')}>{title}</h3>
              <p className={cn(sizes[size].text, 'text-red-700 mt-1')}>{message}</p>
              {onAction && actionLabel && (
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={onAction}
                  className="mt-3 text-danger border-danger hover:bg-red-100"
                >
                  {actionLabel}
                </Button>
              )}
            </div>
          </div>
          {dismissible && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-red-400 hover:text-red-600 transition-colors"
              aria-label="Dismiss error"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Page variant
  return (
    <div className={containerClasses}>
      <div className="max-w-md mx-auto">
        {showIcon && (
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-red-100 p-3">
              <ErrorIcon />
            </div>
          </div>
        )}
        <h1 className={cn(sizes[size].title, 'text-danger mb-2')}>{title}</h1>
        <p className={cn(sizes[size].text, 'text-red-700 mb-6')}>{message}</p>
        {onAction && actionLabel && (
          <Button
            variant="primary"
            onClick={onAction}
            className="bg-danger hover:bg-red-600 border-danger"
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
};

export default ErrorDisplay; 
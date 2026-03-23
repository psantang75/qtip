import React from 'react';
import { cn } from '../../utils/cn';

export interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  color?: 'primary' | 'white' | 'gray' | 'success' | 'warning' | 'danger';
  className?: string;
  label?: string;
  show?: boolean;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  color = 'primary',
  className,
  label,
  show = true
}) => {
  if (!show) return null;

  const sizeConfig = {
    xs: { 
      width: '12px',
      height: '12px',
      strokeWidth: 2
    },
    sm: { 
      width: '16px',
      height: '16px',
      strokeWidth: 2
    },
    md: { 
      width: '24px',
      height: '24px',
      strokeWidth: 2.5
    },
    lg: { 
      width: '32px',
      height: '32px',
      strokeWidth: 3
    },
    xl: { 
      width: '48px',
      height: '48px',
      strokeWidth: 3.5
    }
  };

  const colors = {
    primary: 'text-primary',
    white: 'text-white',
    gray: 'text-gray-500',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger'
  };

  const currentSize = sizeConfig[size];

  const spinnerClasses = cn(
    'animate-spin',
    'inline-block',
    'flex-shrink-0',
    colors[color],
    className
  );

  const spinner = (
    <svg 
      className={spinnerClasses}
      style={{
        width: currentSize.width,
        height: currentSize.height
      }}
      fill="none" 
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle 
        className="opacity-25" 
        cx="12" 
        cy="12" 
        r="10" 
        stroke="currentColor" 
        strokeWidth={currentSize.strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
      <path 
        className="opacity-75" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  if (label) {
    return (
      <div className="flex items-center space-x-2">
        {spinner}
        <span className="text-sm text-neutral-700">{label}</span>
      </div>
    );
  }

  return spinner;
};

export default LoadingSpinner; 
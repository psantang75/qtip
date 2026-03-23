import React from 'react';
import { cn } from '../../utils/cn';
import LoadingSpinner from './LoadingSpinner';

export interface LoadingPageProps {
  message?: string;
  variant?: 'center' | 'top' | 'overlay';
  size?: 'sm' | 'md' | 'lg';
  showLogo?: boolean;
  className?: string;
  backgroundColor?: 'white' | 'neutral' | 'transparent';
}

const LoadingPage: React.FC<LoadingPageProps> = ({
  message = 'Loading...',
  variant = 'center',
  size = 'lg',
  showLogo = false,
  className,
  backgroundColor = 'white'
}) => {
  const baseClasses = [
    'flex',
    'flex-col',
    'items-center',
    'justify-center',
    'min-h-screen'
  ];

  const variants = {
    center: [
      'fixed',
      'inset-0',
      'z-50'
    ],
    top: [
      'pt-20'
    ],
    overlay: [
      'fixed',
      'inset-0',
      'z-50',
      'bg-black',
      'bg-opacity-50'
    ]
  };

  const backgrounds = {
    white: 'bg-white',
    neutral: 'bg-neutral-100',
    transparent: 'bg-transparent'
  };

  const sizes = {
    sm: {
      spinner: 'md' as const,
      text: 'text-sm',
      spacing: 'space-y-2'
    },
    md: {
      spinner: 'lg' as const,
      text: 'text-base',
      spacing: 'space-y-3'
    },
    lg: {
      spinner: 'xl' as const,
      text: 'text-lg',
      spacing: 'space-y-4'
    }
  };

  const containerClasses = cn(
    baseClasses,
    variants[variant],
    variant !== 'overlay' && backgrounds[backgroundColor],
    className
  );

  const contentClasses = cn(
    'flex flex-col items-center',
    sizes[size].spacing,
    variant === 'overlay' && 'bg-white rounded-lg p-8 shadow-lg'
  );

  const Logo = () => (
    <div className="mb-4">
      <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center">
        <span className="text-white font-bold text-xl">Q</span>
      </div>
    </div>
  );

  return (
    <div className={containerClasses}>
      <div className={contentClasses}>
        {showLogo && <Logo />}
        
        <LoadingSpinner 
          size={sizes[size].spinner}
          color={variant === 'overlay' ? 'primary' : 'primary'}
        />
        
        {message && (
          <p className={cn(
            'font-medium text-neutral-700 text-center',
            sizes[size].text
          )}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default LoadingPage; 
import React from 'react';
import { cn } from '../../utils/cn';
import LoadingSpinner from './LoadingSpinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    className, 
    variant = 'primary', 
    size = 'md', 
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    children, 
    disabled,
    ...props 
  }, ref) => {
    const baseClasses = [
      'inline-flex',
      'items-center',
      'justify-center',
      'font-medium',
      'rounded-md',
      'border',
      'transition-all',
      'duration-120',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-offset-2',
      'disabled:opacity-50',
      'disabled:cursor-not-allowed',
      'active:scale-98'
    ];

    const variants = {
      primary: [
        'bg-primary',
        'text-white',
        'border-primary',
        'hover:bg-blue-600',
        'focus:ring-primary',
        'shadow-sm'
      ],
      secondary: [
        'bg-transparent',
        'text-primary',
        'border-primary',
        'hover:bg-primary-blue-10',
        'focus:ring-primary'
      ],
      tertiary: [
        'bg-transparent',
        'text-neutral-700',
        'border-transparent',
        'hover:bg-neutral-100',
        'focus:ring-neutral-500'
      ],
      destructive: [
        'bg-danger',
        'text-white',
        'border-danger',
        'hover:bg-red-600',
        'focus:ring-danger',
        'shadow-sm'
      ],
      ghost: [
        'bg-transparent',
        'text-neutral-700',
        'border-transparent',
        'hover:bg-neutral-100',
        'focus:ring-neutral-500'
      ]
    };

    const sizes = {
      sm: ['px-3', 'py-1.5', 'text-sm', 'gap-1.5'],
      md: ['px-4', 'py-2', 'text-base', 'gap-2'],
      lg: ['px-6', 'py-3', 'text-lg', 'gap-2.5'],
      xl: ['px-8', 'py-4', 'text-xl', 'gap-3']
    };

    const widthClasses = fullWidth ? ['w-full'] : [];

    const buttonClasses = cn(
      baseClasses,
      variants[variant],
      sizes[size],
      widthClasses,
      loading && 'cursor-wait',
      className
    );

    // Map button sizes to spinner sizes
    const getSpinnerSize = () => {
      switch (size) {
        case 'sm': return 'xs';
        case 'md': return 'sm';
        case 'lg': return 'md';
        case 'xl': return 'lg';
        default: return 'sm';
      }
    };

    // Get spinner color based on button variant
    const getSpinnerColor = () => {
      switch (variant) {
        case 'primary':
        case 'destructive':
          return 'white';
        case 'secondary':
          return 'primary';
        default:
          return 'gray';
      }
    };

    return (
      <button
        className={buttonClasses}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <LoadingSpinner 
              size={getSpinnerSize()} 
              color={getSpinnerColor()}
            />
            {children && <span>Loading...</span>}
          </>
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button; 
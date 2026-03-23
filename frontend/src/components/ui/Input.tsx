import React from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  variant?: 'default' | 'filled' | 'outlined';
  inputSize?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({
    className,
    type = 'text',
    label,
    error,
    hint,
    leftIcon,
    rightIcon,
    variant = 'default',
    inputSize = 'md',
    fullWidth = true,
    disabled,
    ...props
  }, ref) => {
    const baseClasses = [
      'form-input',
      'transition-colors',
      'duration-200',
      'placeholder:text-gray-400',
      'disabled:bg-gray-50',
      'disabled:text-gray-500',
      'disabled:cursor-not-allowed'
    ];

    const variants = {
      default: [
        'border-gray-300',
        'focus:border-primary',
        'focus:ring-primary'
      ],
      filled: [
        'bg-neutral-100',
        'border-transparent',
        'focus:bg-white',
        'focus:border-primary',
        'focus:ring-primary'
      ],
      outlined: [
        'bg-transparent',
        'border-2',
        'border-gray-300',
        'focus:border-primary',
        'focus:ring-primary'
      ]
    };

    const sizes = {
      sm: ['px-3', 'py-1.5', 'text-sm'],
      md: ['px-3', 'py-2', 'text-base'],
      lg: ['px-4', 'py-3', 'text-lg']
    };

    const widthClasses = fullWidth ? ['w-full'] : [];

    const inputClasses = cn(
      baseClasses,
      variants[variant],
      sizes[inputSize],
      widthClasses,
      leftIcon && 'pl-10',
      rightIcon && 'pr-10',
      error && [
        'border-danger',
        'focus:border-danger',
        'focus:ring-danger'
      ],
      className
    );

    const inputElement = (
      <div className="relative">
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-gray-400 text-sm">{leftIcon}</span>
          </div>
        )}
        <input
          type={type}
          className={inputClasses}
          ref={ref}
          disabled={disabled}
          aria-invalid={error ? 'true' : 'false'}
          {...props}
        />
        {rightIcon && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <span className="text-gray-400 text-sm">{rightIcon}</span>
          </div>
        )}
      </div>
    );

    if (!label && !error && !hint) {
      return inputElement;
    }

    return (
      <div className={cn('space-y-1', fullWidth && 'w-full')}>
        {label && (
          <label htmlFor={props.id} className="form-label">
            {label}
            {props.required && <span className="text-danger ml-1">*</span>}
          </label>
        )}
        
        {inputElement}
        
        {hint && !error && (
          <p className="text-sm text-neutral-600">{hint}</p>
        )}
        
        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input; 
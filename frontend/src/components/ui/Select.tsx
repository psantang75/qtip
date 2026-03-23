import React from 'react';
import { cn } from '../../utils/cn';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  variant?: 'default' | 'filled' | 'outlined';
  selectSize?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({
    className,
    label,
    error,
    hint,
    options,
    placeholder,
    variant = 'default',
    selectSize = 'md',
    fullWidth = true,
    disabled,
    ...props
  }, ref) => {
    const baseClasses = [
      'form-input',
      'transition-colors',
      'duration-200',
      'cursor-pointer',
      'disabled:bg-gray-50',
      'disabled:text-gray-500',
      'disabled:cursor-not-allowed',
      'appearance-none',
      'bg-no-repeat',
      'bg-right',
      'pr-10'
    ];

    const variants = {
      default: [
        'border-gray-300',
        'focus:border-primary',
        'focus:ring-primary',
        'bg-white'
      ],
      filled: [
        'bg-neutral-100',
        'border-transparent',
        'focus:bg-white',
        'focus:border-primary',
        'focus:ring-primary'
      ],
      outlined: [
        'bg-white',
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

    const selectClasses = cn(
      baseClasses,
      variants[variant],
      sizes[selectSize],
      widthClasses,
      error && [
        'border-danger',
        'focus:border-danger',
        'focus:ring-danger'
      ],
      className
    );

    const selectElement = (
      <div className="relative">
        <select
          className={selectClasses}
          ref={ref}
          disabled={disabled}
          aria-invalid={error ? 'true' : 'false'}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <svg
            className="h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    );

    if (!label && !error && !hint) {
      return selectElement;
    }

    return (
      <div className={cn('space-y-1', fullWidth && 'w-full')}>
        {label && (
          <label htmlFor={props.id} className="form-label">
            {label}
            {props.required && <span className="text-danger ml-1">*</span>}
          </label>
        )}
        
        {selectElement}
        
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

Select.displayName = 'Select';

export default Select; 
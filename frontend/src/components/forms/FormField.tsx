import React from 'react';
import { HiExclamationCircle, HiCheckCircle } from 'react-icons/hi';

/**
 * Form field types
 */
export type FormFieldType = 
  | 'text' 
  | 'email' 
  | 'password' 
  | 'number' 
  | 'tel' 
  | 'url' 
  | 'search'
  | 'textarea' 
  | 'select' 
  | 'checkbox' 
  | 'radio' 
  | 'file' 
  | 'date' 
  | 'datetime-local'
  | 'time';

/**
 * Option for select/radio fields
 */
export interface FormFieldOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

/**
 * FormField component props
 */
export interface FormFieldProps {
  // Field identification
  name: string;
  type?: FormFieldType;
  
  // Field state (from useForm register)
  value?: any;
  onChange?: (event: React.ChangeEvent<any> | any) => void;
  onBlur?: (event?: React.FocusEvent<any>) => void;
  onFocus?: (event?: React.FocusEvent<any>) => void;
  
  // Validation state
  error?: string;
  touched?: boolean;
  dirty?: boolean;
  focused?: boolean;
  
  // Field configuration
  label?: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  
  // Input-specific props
  min?: number | string;
  max?: number | string;
  step?: number | string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  accept?: string; // for file inputs
  multiple?: boolean; // for file/select inputs
  
  // Select/Radio options
  options?: FormFieldOption[];
  
  // Styling
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  errorClassName?: string;
  size?: 'sm' | 'md' | 'lg';
  
  // Layout
  layout?: 'vertical' | 'horizontal';
  labelWidth?: string;
  
  // Additional features
  showValidIcon?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  
  // Custom elements
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  prefix?: string;
  suffix?: string;
}

/**
 * FormField component with comprehensive validation display
 */
export const FormField: React.FC<FormFieldProps> = ({
  name,
  type = 'text',
  value = '',
  onChange,
  onBlur,
  onFocus,
  error,
  touched,
  dirty,
  focused,
  label,
  placeholder,
  helpText,
  required,
  disabled,
  readOnly,
  min,
  max,
  step,
  maxLength,
  minLength,
  pattern,
  accept,
  multiple,
  options = [],
  className = '',
  inputClassName = '',
  labelClassName = '',
  errorClassName = '',
  size = 'md',
  layout = 'vertical',
  labelWidth = '120px',
  showValidIcon = true,
  autoComplete,
  autoFocus,
  leftIcon,
  rightIcon,
  prefix,
  suffix,
}) => {
  // Compute field state
  const hasError = touched && error;
  const isValid = touched && !error && dirty;
  const showSuccess = isValid && showValidIcon;

  // Size classes
  const sizeClasses = {
    sm: 'text-sm px-3 py-1.5',
    md: 'text-base px-3 py-2',
    lg: 'text-lg px-4 py-3',
  };

  // Base input classes
  const baseInputClasses = `
    block w-full rounded-md border transition-colors duration-200
    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
    disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
    ${sizeClasses[size]}
    ${hasError 
      ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500' 
      : isValid
        ? 'border-green-300 focus:ring-green-500 focus:border-green-500'
        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
    }
    ${inputClassName}
  `.trim().replace(/\s+/g, ' ');

  // Container classes
  const containerClasses = `
    ${layout === 'horizontal' ? 'flex items-start space-x-4' : 'space-y-1'}
    ${className}
  `;

  // Label classes
  const labelClasses = `
    block text-sm font-medium text-gray-700
    ${required ? "after:content-['*'] after:text-red-500 after:ml-1" : ''}
    ${layout === 'horizontal' ? `flex-shrink-0` : ''}
    ${labelClassName}
  `;

  // Common input props
  const commonInputProps = {
    id: name,
    name,
    value,
    onChange,
    onBlur,
    onFocus,
    disabled,
    readOnly,
    // Don't pass required to HTML elements - we handle validation in React
    placeholder,
    autoComplete,
    autoFocus,
    className: baseInputClasses,
  };

  // Render input based on type
  const renderInput = () => {
    const inputWithIcons = (input: React.ReactNode) => {
      if (!leftIcon && !rightIcon && !prefix && !suffix && !showSuccess && !hasError) {
        return input;
      }

      return (
        <div className="relative">
          {/* Left icon/prefix */}
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div className="text-gray-400">{leftIcon}</div>
            </div>
          )}
          {prefix && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 text-sm">{prefix}</span>
            </div>
          )}
          
          {/* Input with adjusted padding */}
          <div className={leftIcon || prefix ? 'pl-10' : rightIcon || suffix || showSuccess || hasError ? 'pr-10' : ''}>
            {input}
          </div>
          
          {/* Right icon/suffix/validation icons */}
          {(rightIcon || suffix || showSuccess || hasError) && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {hasError && (
                <HiExclamationCircle className="h-5 w-5 text-red-500" />
              )}
              {showSuccess && (
                <HiCheckCircle className="h-5 w-5 text-green-500" />
              )}
              {rightIcon && !hasError && !showSuccess && (
                <div className="text-gray-400">{rightIcon}</div>
              )}
              {suffix && !hasError && !showSuccess && !rightIcon && (
                <span className="text-gray-500 text-sm">{suffix}</span>
              )}
            </div>
          )}
        </div>
      );
    };

    switch (type) {
      case 'textarea':
        return inputWithIcons(
          <textarea
            {...commonInputProps}
            rows={4}
            minLength={minLength}
            maxLength={maxLength}
            className={`${baseInputClasses} resize-vertical`}
          />
        );

      case 'select':
        return inputWithIcons(
          <select {...commonInputProps} multiple={multiple}>
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
        );

      case 'checkbox':
        return (
          <div className="flex items-center">
            <input
              {...commonInputProps}
              type="checkbox"
              checked={value}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            {label && (
              <label htmlFor={name} className="ml-2 block text-sm text-gray-900">
                {label}
              </label>
            )}
          </div>
        );

      case 'radio':
        // Radio button size based on form size - Updated with larger, more visible sizes
        const radioSizes = {
          sm: { width: '18px', height: '18px' },  // Increased from 14px to 18px
          md: { width: '20px', height: '20px' },  // Increased from 18px to 20px
          lg: { width: '24px', height: '24px' },  // Increased from 22px to 24px
        };
        
        const radioSize = radioSizes[size];
        
        return (
          <div className="space-y-3">
            {options.map((option) => (
              <div key={option.value} className="flex items-center">
                <input
                  id={`${name}-${option.value}`}
                  name={name}
                  type="radio"
                  value={option.value}
                  checked={value === option.value}
                  onChange={onChange}
                  onBlur={onBlur}
                  onFocus={onFocus}
                  disabled={disabled || option.disabled}
                  className="text-blue-600 focus:ring-blue-500 border-gray-300 focus:ring-2"
                  style={{
                    width: radioSize.width,
                    height: radioSize.height,
                    minWidth: radioSize.width,
                    minHeight: radioSize.height,
                  }}
                />
                <label
                  htmlFor={`${name}-${option.value}`}
                  className={`ml-3 block text-gray-900 cursor-pointer ${
                    size === 'sm' ? 'text-sm' : 
                    size === 'lg' ? 'text-lg' : 'text-base'
                  }`}
                >
                  {option.label}
                </label>
              </div>
            ))}
          </div>
        );

      case 'file':
        return inputWithIcons(
          <input
            {...commonInputProps}
            type="file"
            accept={accept}
            multiple={multiple}
            className={`${baseInputClasses} file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100`}
          />
        );

      default:
        return inputWithIcons(
          <input
            {...commonInputProps}
            type={type}
            min={min}
            max={max}
            step={step}
            minLength={minLength}
            maxLength={maxLength}
            pattern={pattern}
          />
        );
    }
  };

  // Don't render label for checkbox (it's handled inline)
  const shouldRenderLabel = label && type !== 'checkbox';

  return (
    <div className={containerClasses}>
      {/* Label */}
      {shouldRenderLabel && (
        <label
          htmlFor={name}
          className={labelClasses}
          style={layout === 'horizontal' ? { width: labelWidth } : undefined}
        >
          {label}
        </label>
      )}

      {/* Input container */}
      <div className={layout === 'horizontal' ? 'flex-1' : ''}>
        {renderInput()}

        {/* Help text */}
        {helpText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helpText}</p>
        )}

        {/* Error message */}
        {hasError && (
          <p className={`mt-1 text-sm text-red-600 ${errorClassName}`}>
            {error}
          </p>
        )}

        {/* Character count for text inputs */}
        {(type === 'text' || type === 'textarea') && maxLength && value && (
          <p className="mt-1 text-xs text-gray-400 text-right">
            {value.length}/{maxLength}
          </p>
        )}
      </div>
    </div>
  );
}; 
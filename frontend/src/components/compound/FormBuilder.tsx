// @ts-nocheck
import React, { useState } from 'react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Card, { CardContent, CardHeader, CardTitle } from '../ui/Card';
import { cn } from '../../utils/cn';
import type { SelectOption } from '../ui/Select';

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select' | 'checkbox' | 'radio';
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: SelectOption[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  defaultValue?: any;
  disabled?: boolean;
  hint?: string;
}

export interface FormBuilderProps {
  fields: FormField[];
  onSubmit: (data: Record<string, any>) => void;
  onFieldChange?: (fieldId: string, value: any) => void;
  submitLabel?: string;
  loading?: boolean;
  className?: string;
  layout?: 'vertical' | 'horizontal' | 'grid';
  showReset?: boolean;
  resetLabel?: string;
}

const FormBuilder: React.FC<FormBuilderProps> = ({
  fields,
  onSubmit,
  onFieldChange,
  submitLabel = 'Submit',
  loading = false,
  className,
  layout = 'vertical',
  showReset = true,
  resetLabel = 'Reset'
}) => {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initialData: Record<string, any> = {};
    fields.forEach(field => {
      initialData[field.id] = field.defaultValue || '';
    });
    return initialData;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = (field: FormField, value: any): string | null => {
    if (field.required && (!value || value === '')) {
      return `${field.label} is required`;
    }

    if (field.validation) {
      const { min, max, pattern, message } = field.validation;

      if (min !== undefined && value.length < min) {
        return message || `${field.label} must be at least ${min} characters`;
      }

      if (max !== undefined && value.length > max) {
        return message || `${field.label} must be no more than ${max} characters`;
      }

      if (pattern && !new RegExp(pattern).test(value)) {
        return message || `${field.label} format is invalid`;
      }
    }

    return null;
  };

  const handleFieldChange = (fieldId: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
    
    // Clear error when user starts typing
    if (errors[fieldId]) {
      setErrors(prev => ({ ...prev, [fieldId]: '' }));
    }

    onFieldChange?.(fieldId, value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    
    fields.forEach(field => {
      const error = validateField(field, formData[field.id]);
      if (error) {
        newErrors[field.id] = error;
      }
    });

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onSubmit(formData);
    }
  };

  const handleReset = () => {
    const initialData: Record<string, any> = {};
    fields.forEach(field => {
      initialData[field.id] = field.defaultValue || '';
    });
    setFormData(initialData);
    setErrors({});
  };

  const layoutClasses = {
    vertical: 'space-y-4',
    horizontal: 'flex flex-wrap gap-4',
    grid: 'grid grid-cols-1 md:grid-cols-2 gap-4'
  };

  const renderField = (field: FormField) => {
    const commonProps = {
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      required: field.required,
      disabled: field.disabled,
      error: errors[field.id],
      hint: field.hint,
      value: formData[field.id] || '',
      fullWidth: layout !== 'horizontal'
    };

    switch (field.type) {
      case 'textarea':
        return (
          <div key={field.id}>
            <label htmlFor={field.id} className="form-label">
              {field.label}
              {field.required && <span className="text-danger ml-1">*</span>}
            </label>
            <textarea
              id={commonProps.id}
              placeholder={commonProps.placeholder}
              required={commonProps.required}
              disabled={commonProps.disabled}
              value={commonProps.value}
              className={cn(
                'form-input min-h-[100px] w-full',
                errors[field.id] && 'border-danger focus:border-danger focus:ring-danger'
              )}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
            />
            {field.hint && <p className="text-sm text-neutral-600 mt-1">{field.hint}</p>}
            {errors[field.id] && <p className="text-sm text-danger mt-1">{errors[field.id]}</p>}
          </div>
        );

      case 'select':
        return (
          <Select
            key={field.id}
            {...commonProps}
            options={field.options || []}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
          />
        );

      case 'checkbox':
        return (
          <div key={field.id} className="flex items-center space-x-2">
            <input
              type="checkbox"
              id={field.id}
              checked={formData[field.id] || false}
              onChange={(e) => handleFieldChange(field.id, e.target.checked)}
              disabled={field.disabled}
              className="rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor={field.id} className="text-sm font-medium text-neutral-700">
              {field.label}
              {field.required && <span className="text-danger ml-1">*</span>}
            </label>
            {errors[field.id] && <p className="text-sm text-danger">{errors[field.id]}</p>}
          </div>
        );

      case 'radio':
        return (
          <div key={field.id} className="space-y-2">
            <label className="form-label">
              {field.label}
              {field.required && <span className="text-danger ml-1">*</span>}
            </label>
            <div className="space-y-2">
              {field.options?.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id={`${field.id}-${option.value}`}
                    name={field.id}
                    value={option.value}
                    checked={formData[field.id] === option.value}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    disabled={field.disabled || option.disabled}
                    className="border-gray-300 text-primary focus:ring-primary"
                  />
                  <label htmlFor={`${field.id}-${option.value}`} className="text-sm text-neutral-700">
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
            {errors[field.id] && <p className="text-sm text-danger">{errors[field.id]}</p>}
          </div>
        );

      default:
        return (
          <Input
            key={field.id}
            {...commonProps}
            type={field.type}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
          />
        );
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Form</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <div className={layoutClasses[layout]}>
            {fields.map(renderField)}
          </div>

          <div className="flex gap-4 mt-6">
            <Button
              type="submit"
              loading={loading}
              className="flex-1 sm:flex-none"
            >
              {submitLabel}
            </Button>
            
            {showReset && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleReset}
                disabled={loading}
              >
                {resetLabel}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default FormBuilder; 
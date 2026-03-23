import type { ZodSchema } from 'zod';

/**
 * Form submission configuration
 */
export interface FormSubmissionConfig<T = any> {
  // Validation
  schema?: ZodSchema<T>;
  validateBeforeSubmit?: boolean;
  
  // Loading states
  showLoadingState?: boolean;
  loadingMessage?: string;
  
  // Success handling
  onSuccess?: (data: T, response?: any) => void | Promise<void>;
  successMessage?: string;
  redirectOnSuccess?: string;
  resetFormOnSuccess?: boolean;
  
  // Error handling
  onError?: (error: any, data?: T) => void | Promise<void>;
  showErrorMessage?: boolean;
  retryOnError?: boolean;
  maxRetries?: number;
  
  // Callbacks
  onBeforeSubmit?: (data: T) => boolean | Promise<boolean>;
  onAfterSubmit?: (data: T, response?: any, error?: any) => void | Promise<void>;
  
  // Transform data before submission
  transformData?: (data: T) => any;
  
  // API configuration
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Form submission result
 */
export interface FormSubmissionResult<T = any> {
  success: boolean;
  data?: T;
  response?: any;
  error?: any;
  validationErrors?: Record<string, string>;
  retryCount?: number;
}

/**
 * Form submission state
 */
export interface FormSubmissionState {
  isSubmitting: boolean;
  hasSubmitted: boolean;
  submitCount: number;
  lastSubmissionTime?: Date;
  lastError?: any;
  retryCount: number;
}

/**
 * Advanced form submission handler
 */
export class FormSubmissionHandler<T = any> {
  private config: FormSubmissionConfig<T>;
  private state: FormSubmissionState;
  private abortController?: AbortController;

  constructor(config: FormSubmissionConfig<T> = {}) {
    this.config = {
      validateBeforeSubmit: true,
      showLoadingState: true,
      showErrorMessage: true,
      resetFormOnSuccess: false,
      retryOnError: false,
      maxRetries: 3,
      timeout: 30000,
      ...config,
    };

    this.state = {
      isSubmitting: false,
      hasSubmitted: false,
      submitCount: 0,
      retryCount: 0,
    };
  }

  /**
   * Submit form with comprehensive error handling
   */
  async submit(
    data: T,
    submitFunction: (data: any) => Promise<any>
  ): Promise<FormSubmissionResult<T>> {
    // Prevent multiple simultaneous submissions
    if (this.state.isSubmitting) {
      return {
        success: false,
        error: new Error('Form is already being submitted'),
      };
    }

    // Create abort controller for request cancellation
    this.abortController = new AbortController();

    try {
      this.state.isSubmitting = true;
      this.state.submitCount++;
      this.state.lastSubmissionTime = new Date();

      // Validate data before submission
      if (this.config.validateBeforeSubmit && this.config.schema) {
        try {
          await this.config.schema.parseAsync(data);
        } catch (error: any) {
          const validationErrors: Record<string, string> = {};
          if (error.errors) {
            error.errors.forEach((err: any) => {
              const field = err.path.join('.');
              validationErrors[field] = err.message;
            });
          }

          return {
            success: false,
            error: new Error('Validation failed'),
            validationErrors,
          };
        }
      }

      // Call before submit callback
      if (this.config.onBeforeSubmit) {
        const shouldContinue = await this.config.onBeforeSubmit(data);
        if (!shouldContinue) {
          return {
            success: false,
            error: new Error('Submission cancelled by onBeforeSubmit'),
          };
        }
      }

      // Transform data if needed
      const submissionData = this.config.transformData
        ? this.config.transformData(data)
        : data;

      // Perform the actual submission with timeout
      const response = await Promise.race([
        submitFunction(submissionData),
        this.createTimeoutPromise(),
      ]);

      // Handle successful submission
      this.state.hasSubmitted = true;
      this.state.retryCount = 0;

      // Call success callback
      if (this.config.onSuccess) {
        await this.config.onSuccess(data, response);
      }

      // Call after submit callback
      if (this.config.onAfterSubmit) {
        await this.config.onAfterSubmit(data, response);
      }

      return {
        success: true,
        data,
        response,
        retryCount: this.state.retryCount,
      };

    } catch (error: any) {
      this.state.lastError = error;

      // Handle retry logic
      if (this.config.retryOnError && this.state.retryCount < (this.config.maxRetries || 3)) {
        this.state.retryCount++;
        
        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, this.state.retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry submission
        return this.submit(data, submitFunction);
      }

      // Call error callback
      if (this.config.onError) {
        await this.config.onError(error, data);
      }

      // Call after submit callback
      if (this.config.onAfterSubmit) {
        await this.config.onAfterSubmit(data, undefined, error);
      }

      return {
        success: false,
        data,
        error,
        retryCount: this.state.retryCount,
      };

    } finally {
      this.state.isSubmitting = false;
      this.abortController = undefined;
    }
  }

  /**
   * Cancel ongoing submission
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state.isSubmitting = false;
  }

  /**
   * Reset submission state
   */
  reset(): void {
    this.cancel();
    this.state = {
      isSubmitting: false,
      hasSubmitted: false,
      submitCount: 0,
      retryCount: 0,
    };
  }

  /**
   * Get current submission state
   */
  getState(): FormSubmissionState {
    return { ...this.state };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FormSubmissionConfig<T>>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Create timeout promise
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      // Clear timeout if request is aborted
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Request aborted'));
      });
    });
  }
}

/**
 * Simple form submission utility function
 */
export const submitForm = async <T = any>(
  data: T,
  submitFunction: (data: any) => Promise<any>,
  config: FormSubmissionConfig<T> = {}
): Promise<FormSubmissionResult<T>> => {
  const handler = new FormSubmissionHandler(config);
  return handler.submit(data, submitFunction);
};

/**
 * Create a reusable form submission hook
 */
export const createFormSubmitter = <T = any>(
  submitFunction: (data: any) => Promise<any>,
  config: FormSubmissionConfig<T> = {}
) => {
  const handler = new FormSubmissionHandler(config);

  return {
    submit: (data: T) => handler.submit(data, submitFunction),
    cancel: () => handler.cancel(),
    reset: () => handler.reset(),
    getState: () => handler.getState(),
    updateConfig: (newConfig: Partial<FormSubmissionConfig<T>>) => 
      handler.updateConfig(newConfig),
  };
};

/**
 * Common error handlers for different scenarios
 */
export const errorHandlers = {
  // Network errors
  network: (error: any) => {
    if (error.code === 'NETWORK_ERROR' || !navigator.onLine) {
      return 'Network connection failed. Please check your internet connection.';
    }
    return 'Network error occurred. Please try again.';
  },

  // Validation errors
  validation: (error: any) => {
    if (error.status === 400 || error.status === 422) {
      return 'Please check your input and try again.';
    }
    return 'Validation failed. Please review your input.';
  },

  // Authentication errors
  auth: (error: any) => {
    if (error.status === 401) {
      return 'Your session has expired. Please log in again.';
    }
    if (error.status === 403) {
      return 'You do not have permission to perform this action.';
    }
    return 'Authentication error occurred.';
  },

  // Server errors
  server: (error: any) => {
    if (error.status >= 500) {
      return 'Server error occurred. Please try again later.';
    }
    return 'An unexpected error occurred. Please try again.';
  },

  // Generic error handler
  generic: (error: any) => {
    return error.message || 'An error occurred. Please try again.';
  },
};

/**
 * Success handlers for different scenarios
 */
export const successHandlers = {
  // Created new resource
  created: (data: any, response: any) => {
    return 'Successfully created!';
  },

  // Updated existing resource
  updated: (data: any, response: any) => {
    return 'Successfully updated!';
  },

  // Deleted resource
  deleted: (data: any, response: any) => {
    return 'Successfully deleted!';
  },

  // Generic success
  generic: (data: any, response: any) => {
    return 'Operation completed successfully!';
  },
}; 
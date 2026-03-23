/**
 * Error Handling Utilities
 * Centralized error handling for consistent behavior across the application
 */

/**
 * Checks if an error is a 401 (Unauthorized) authentication error
 * @param error - The error object from a catch block
 * @returns true if this is a 401 error that should be handled by the auth interceptor
 */
export function isAuthenticationError(error: any): boolean {
  return error?.response?.status === 401;
}

/**
 * Checks if an HTTP response status indicates authentication failure
 * Used for fetch() API calls that don't use axios interceptors
 * @param status - HTTP response status code
 * @returns true if this is a 401 error
 */
export function isAuthenticationStatus(status: number): boolean {
  return status === 401;
}

/**
 * Handles authentication errors consistently
 * Clears local storage and redirects to login page
 * Use this for fetch() API calls that bypass axios interceptors
 */
export function handleAuthenticationFailure(): void {
  console.log('Session expired - redirecting to login');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('refreshToken');
  window.location.href = '/login';
}

/**
 * Wrapper for error handlers that need to check for authentication errors
 * Returns true if the error was handled (authentication error), false otherwise
 * @param error - The error object from a catch block
 * @returns true if this was an authentication error (handled), false if caller should handle it
 */
export function handleErrorIfAuthentication(error: any): boolean {
  if (isAuthenticationError(error)) {
    console.log('Session expired - axios interceptor will handle redirect to login');
    // Don't set error messages, let the axios interceptor handle cleanup and redirect
    return true; // Indicate that the error was handled
  }
  return false; // Caller should handle this error
}

/**
 * Gets a user-friendly error message from an error object
 * @param error - The error object
 * @param defaultMessage - Default message if no specific message is found
 * @returns User-friendly error message
 */
export function getErrorMessage(error: any, defaultMessage: string = 'An error occurred. Please try again.'): string {
  // Check for authentication errors
  if (isAuthenticationError(error)) {
    return 'Your session has expired. Please log in again.';
  }
  
  // Check for specific error messages in the response
  if (error?.response?.data?.error) {
    const apiError = error.response.data.error;
    if (typeof apiError === 'string') {
      return apiError;
    } else if (apiError.message) {
      return apiError.message;
    }
  }
  
  // Check for general error messages
  if (error?.response?.data?.message) {
    return error.response.data.message;
  }
  
  // Check for error message property
  if (error?.message && typeof error.message === 'string') {
    return error.message;
  }
  
  // Return default message
  return defaultMessage;
}

/**
 * Type guard to check if an error has a response object
 */
export function hasErrorResponse(error: any): error is { response: { status: number; data: any } } {
  return error && typeof error === 'object' && 'response' in error;
}


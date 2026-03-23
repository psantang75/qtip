import { useState, useEffect, useCallback, useRef } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export interface UseAsyncOptions {
  immediate?: boolean;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

export interface UseAsyncReturn<T> extends AsyncState<T> {
  execute: (...args: any[]) => Promise<T | undefined>;
  reset: () => void;
}

/**
 * Custom hook for handling async operations with loading, error, and success states
 * 
 * @param asyncFunction - The async function to execute
 * @param options - Configuration options
 * @returns Object containing data, loading, error states and control functions
 */
export function useAsync<T = any>(
  asyncFunction: (...args: any[]) => Promise<T>,
  options: UseAsyncOptions = {}
): UseAsyncReturn<T> {
  const { immediate = false, onSuccess, onError } = options;
  
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: false,
    error: null
  });
  
  // Keep track of the latest async function to avoid stale closures
  const asyncFunctionRef = useRef(asyncFunction);
  asyncFunctionRef.current = asyncFunction;
  
  // Keep track of the current execution to handle race conditions
  const executionRef = useRef(0);

  const execute = useCallback(async (...args: any[]): Promise<T | undefined> => {
    const currentExecution = ++executionRef.current;
    
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await asyncFunctionRef.current(...args);
      
      // Only update state if this is still the latest execution
      if (currentExecution === executionRef.current) {
        setState({ data: result, loading: false, error: null });
        onSuccess?.(result);
      }
      
      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      
      // Only update state if this is still the latest execution
      if (currentExecution === executionRef.current) {
        setState({ data: null, loading: false, error: errorObj });
        onError?.(errorObj);
      }
      
      throw errorObj;
    }
  }, [onSuccess, onError]);

  const reset = useCallback(() => {
    executionRef.current++;
    setState({ data: null, loading: false, error: null });
  }, []);

  // Execute immediately if requested
  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [immediate, execute]);

  return {
    ...state,
    execute,
    reset
  };
}

/**
 * Hook for handling async operations with data fetching pattern
 * Automatically executes on mount and provides refetch capability
 */
export function useFetch<T = any>(
  asyncFunction: () => Promise<T>,
  dependencies: any[] = []
): UseAsyncReturn<T> & { refetch: () => Promise<T | undefined> } {
  const asyncHook = useAsync(asyncFunction, { immediate: true });

  // Refetch when dependencies change
  useEffect(() => {
    if (dependencies.length > 0) {
      asyncHook.execute();
    }
  }, dependencies);

  return {
    ...asyncHook,
    refetch: asyncHook.execute
  };
}

/**
 * Hook for handling form submissions with async operations
 */
export function useAsyncSubmit<T = any>(
  submitFunction: (...args: any[]) => Promise<T>,
  options: UseAsyncOptions = {}
): UseAsyncReturn<T> & { submit: (...args: any[]) => Promise<void> } {
  const asyncHook = useAsync(submitFunction, options);

  const submit = useCallback(async (...args: any[]) => {
    try {
      await asyncHook.execute(...args);
    } catch (error) {
      // Error is already handled by useAsync
      // This prevents unhandled promise rejection
    }
  }, [asyncHook.execute]);

  return {
    ...asyncHook,
    submit
  };
}

export default useAsync; 
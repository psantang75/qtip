import { useState, useCallback } from 'react';

/**
 * Custom hook to persist state in localStorage with no expiration
 * @param key - Unique key for localStorage
 * @param initialValue - Default value if nothing in localStorage (can be a function for lazy evaluation)
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T)
): [T, (value: T | ((val: T) => T)) => void, () => void] {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key);
      
      if (!item) {
        return initialValue instanceof Function ? initialValue() : initialValue;
      }

      return JSON.parse(item);
    } catch (error) {
      console.warn(`Error loading localStorage key "${key}":`, error);
      return initialValue instanceof Function ? initialValue() : initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage.
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      // Use functional updater to avoid depending on storedValue
      setStoredValue((currentValue) => {
        const valueToStore = value instanceof Function ? value(currentValue) : value;
        
        // Save to local storage
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
        
        return valueToStore;
      });
    } catch (error) {
      console.warn(`Error saving localStorage key "${key}":`, error);
    }
  }, [key]);

  // Clear function to manually reset (recomputes initialValue if it's a function)
  const clearValue = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
      // If initialValue is a function, call it to get fresh defaults
      const freshValue = initialValue instanceof Function ? initialValue() : initialValue;
      setStoredValue(freshValue);
    } catch (error) {
      console.warn(`Error clearing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  return [storedValue, setValue, clearValue];
}

/**
 * Hook specifically for filter persistence
 * Automatically namespaces keys for filters with user ID for isolation
 * @param componentName - Name of the component using filters
 * @param initialFilters - Default filter values (can be a function for lazy evaluation)
 * @param userId - User ID to isolate filters per user (optional for backwards compatibility)
 */
export function usePersistentFilters<T>(
  componentName: string,
  initialFilters: T | (() => T),
  userId?: string | number
): [T, (value: T | ((val: T) => T)) => void, () => void] {
  // Include userId in key if provided, otherwise fallback to component name only
  const key = userId 
    ? `qtip_filters_${userId}_${componentName}`
    : `qtip_filters_${componentName}`;
    
  return useLocalStorage<T>(key, initialFilters);
}

/**
 * Hook for pagination persistence
 * Automatically namespaces keys for pagination with user ID for isolation
 * @param componentName - Name of the component using pagination
 * @param initialPage - Default page number
 * @param initialPageSize - Default page size
 * @param userId - User ID to isolate pagination per user (optional for backwards compatibility)
 */
export function usePersistentPagination(
  componentName: string,
  initialPage: number = 1,
  initialPageSize: number = 10,
  userId?: string | number
): {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  clearPagination: () => void;
} {
  // Include userId in keys if provided, otherwise fallback to component name only
  const pageKey = userId
    ? `qtip_pagination_${userId}_${componentName}_page`
    : `qtip_pagination_${componentName}_page`;
  const pageSizeKey = userId
    ? `qtip_pagination_${userId}_${componentName}_pageSize`
    : `qtip_pagination_${componentName}_pageSize`;

  const [currentPage, setCurrentPage, clearPage] = useLocalStorage(
    pageKey,
    initialPage
  );

  const [pageSize, setPageSize, clearPageSize] = useLocalStorage(
    pageSizeKey,
    initialPageSize
  );

  const clearPagination = useCallback(() => {
    clearPage();
    clearPageSize();
  }, [clearPage, clearPageSize]);

  return {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    clearPagination
  };
}


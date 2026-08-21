/**
 * Helper utilities for handling API responses with varying structures
 */

/**
 * Gets the data array from an API response regardless of whether it's directly
 * in response.data or nested in response.data.data
 * 
 * @param responseData - The response.data from an API call
 * @param defaultValue - The default value to return if data cannot be extracted
 * @returns The data array or defaultValue if not found
 */
export const getArrayFromResponse = <T>(
  responseData: unknown, 
  defaultValue: T[] = []
): T[] => {
  if (Array.isArray(responseData)) {
    return responseData as T[];
  } 

  const obj = responseData as { data?: unknown; forms?: unknown } | null | undefined;

  if (obj && Array.isArray(obj.data)) {
    return obj.data as T[];
  }
  
  // Check for forms array (used by forms API)
  if (obj && Array.isArray(obj.forms)) {
    return obj.forms as T[];
  }
  
  return defaultValue;
};

/**
 * Gets pagination information from an API response
 * 
 * @param responseData - The response.data from an API call
 * @param itemsPerPage - Items per page for calculating total pages
 * @returns Object with total pages
 */
export const getPaginationFromResponse = (
  responseData: unknown,
  itemsPerPage: number
): { totalPages: number } => {
  const obj = responseData as
    | { pagination?: { total?: number }; total?: number }
    | null
    | undefined;

  // Check if pagination exists directly in the response
  if (obj?.pagination?.total) {
    return {
      totalPages: Math.ceil(obj.pagination.total / itemsPerPage)
    };
  }
  
  // Check if pagination is in a different format
  if (obj?.total) {
    return {
      totalPages: Math.ceil(obj.total / itemsPerPage)
    };
  }
  
  // Default to 1 page if no pagination info found
  return { totalPages: 1 };
}; 

export function getCookie(name: string): string | undefined {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift();
} 
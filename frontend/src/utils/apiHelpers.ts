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
  responseData: any, 
  defaultValue: T[] = []
): T[] => {
  if (Array.isArray(responseData)) {
    return responseData;
  } 
  
  if (responseData && Array.isArray(responseData.data)) {
    return responseData.data;
  }
  
  // Check for forms array (used by forms API)
  if (responseData && Array.isArray(responseData.forms)) {
    return responseData.forms;
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
  responseData: any,
  itemsPerPage: number
): { totalPages: number } => {
  // Check if pagination exists directly in the response
  if (responseData?.pagination?.total) {
    return {
      totalPages: Math.ceil(responseData.pagination.total / itemsPerPage)
    };
  }
  
  // Check if pagination is in a different format
  if (responseData?.total) {
    return {
      totalPages: Math.ceil(responseData.total / itemsPerPage)
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
import axios from 'axios';
import { getCookie } from '../utils/apiHelpers';

// In-flight GET de-duplication map
// Keyed by method+url+sorted params; stores the active promise
const inflightMap = new Map<string, Promise<any>>();

const getSignature = (config: any) => {
  const method = (config.method || 'get').toLowerCase();
  // Use the full URL including baseURL for accurate matching
  const baseURL = config.baseURL || '';
  const url = (config.url || '').replace(baseURL, ''); // Remove baseURL if present
  
  if (method !== 'get') {
    return `${method}:${url}`;
  }

  // Normalize params order for a stable signature
  const params = config.params || {};
  const orderedParams = Object.keys(params)
    .sort()
    .reduce<Record<string, any>>((acc, key) => {
      const value = params[key];
      // Normalize empty strings and null/undefined to empty string for consistency
      acc[key] = value === null || value === undefined ? '' : String(value);
      return acc;
    }, {});

  const paramsString = JSON.stringify(orderedParams);
  return `${method}:${url}?${paramsString}`;
};

// Create a custom axios instance
const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000, // 15 seconds timeout
});

// Store the original request method - this is what all axios methods (get, post, etc.) call
const originalRequest = apiClient.request.bind(apiClient);

// Wrap the request method to intercept ALL requests for deduplication
apiClient.request = function(config: any) {
  const method = (config.method || 'get').toLowerCase();
  const isGet = method === 'get';
  const skipDedup = (config as any).skipDedup === true;

  // Global GET de-duplication - intercept at request level
  if (isGet && !skipDedup) {
    const signature = getSignature(config);
    const existing = inflightMap.get(signature);
    
    if (existing) {
      console.warn(`🚫 [DEDUP] BLOCKED duplicate GET: ${config.url}`, {
        signature,
        params: config.params,
        inFlightCount: inflightMap.size,
        timestamp: new Date().toISOString()
      });
      return existing;
    }

    console.log(`✅ [DEDUP] NEW GET request: ${config.url}`, {
      signature,
      params: config.params,
      inFlightCount: inflightMap.size + 1,
      timestamp: new Date().toISOString()
    });

    // Create the request promise
    const requestPromise = originalRequest(config)
      .then((response: any) => {
        console.log(`✓ [DEDUP] COMPLETED GET: ${config.url}`, {
          signature,
          inFlightCount: inflightMap.size - 1,
          timestamp: new Date().toISOString()
        });
        inflightMap.delete(signature);
        return response;
      })
      .catch((error: any) => {
        console.error(`✗ [DEDUP] FAILED GET: ${config.url}`, {
          signature,
          error: error.message,
          inFlightCount: inflightMap.size - 1,
          timestamp: new Date().toISOString()
        });
        inflightMap.delete(signature);
        throw error;
      });

    inflightMap.set(signature, requestPromise);
    return requestPromise;
  }

  // For non-GET or skipDedup, use original request
  return originalRequest(config);
};

// Add a request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Get the token from localStorage
    const token = localStorage.getItem('token');
    
    // If token exists, add it to the headers
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      if (import.meta.env.DEV) {
        console.log('Token added to request:', token.substring(0, 15) + '...');
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn('No token found in localStorage for request:', config.url);
      }
    }

    // Add CSRF token for state-changing requests
    const csrfToken = getCookie('XSRF-TOKEN');
    if (
      csrfToken &&
      config.method &&
      ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())
    ) {
      if (config.headers) {
        config.headers['X-XSRF-TOKEN'] = csrfToken;
      }
    }

    // Let the browser set the content type for FormData to include the boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    // For debugging in development
    if (import.meta.env.DEV) {
      console.log('Request:', {
        method: config.method,
        url: config.url,
        data: config.data instanceof FormData ? 'FormData object' : config.data,
        params: config.params,
        headers: {
          ...config.headers,
          Authorization: typeof config.headers.Authorization === 'string' ? 
            config.headers.Authorization.substring(0, 15) + '...' : 
            'Not set'
        },
      });
    }

    return config;
  },
  (error) => {
    console.error('Request error:', error);
    return Promise.reject(error);
  }
);

// Add a response interceptor
apiClient.interceptors.response.use(
  (response) => {
    // For debugging in development
    if (import.meta.env.DEV) {
      console.log('Response:', {
        status: response.status,
        data: response.data,
      });
    }
    
    return response;
  },
  (error) => {
    // Enhanced error logging
    if (error.response) {
      // The server responded with a status code outside the 2xx range
      console.error('API Error Response:', {
        status: error.response.status,
        data: error.response.data,
        url: error.config.url,
        method: error.config.method,
      });
      
      // Handle specific error status codes
      if (error.response.status === 401) {
        // Unauthorized - clear token and redirect to login
        console.log('apiClient: 401 Unauthorized - redirecting to login');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        
        // Return a promise that never resolves to prevent error handlers from running
        return new Promise(() => {});
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('API No Response Error:', {
        request: error.request,
        url: error.config.url,
        method: error.config.method,
      });
    } else {
      // Something happened in setting up the request
      console.error('API Configuration Error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;

import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { getCookie } from '../utils/apiHelpers';
import { logError, logWarn } from '../utils/errorHandling';

interface DedupConfig extends InternalAxiosRequestConfig {
  skipDedup?: boolean;
}

// In-flight GET de-duplication map
const inflightMap = new Map<string, Promise<unknown>>();

const getSignature = (config: InternalAxiosRequestConfig) => {
  const method = (config.method || 'get').toLowerCase();
  const baseURL = config.baseURL || '';
  const url = (config.url || '').replace(baseURL, '');

  if (method !== 'get') return `${method}:${url}`;

  const params = (config.params || {}) as Record<string, unknown>;
  const orderedParams = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      const value = params[key];
      acc[key] = value === null || value === undefined ? '' : String(value);
      return acc;
    }, {});

  return `${method}:${url}?${JSON.stringify(orderedParams)}`;
};

const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

const originalRequest = apiClient.request.bind(apiClient);

apiClient.request = function <T = unknown>(config: DedupConfig) {
  const method = (config.method || 'get').toLowerCase();
  const isGet = method === 'get';
  const skipDedup = config.skipDedup === true;

  if (isGet && !skipDedup) {
    const signature = getSignature(config);
    const existing = inflightMap.get(signature);

    if (existing) {
      if (import.meta.env.DEV) {
        logWarn('apiClient', `[DEDUP] Blocked duplicate GET: ${config.url}`);
      }
      return existing as ReturnType<typeof originalRequest<T>>;
    }

    const requestPromise = originalRequest<T>(config)
      .then((response) => {
        inflightMap.delete(signature);
        return response;
      })
      .catch((error: unknown) => {
        inflightMap.delete(signature);
        throw error;
      });

    inflightMap.set(signature, requestPromise as Promise<unknown>);
    return requestPromise;
  }

  return originalRequest<T>(config);
};

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

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

    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    return config;
  },
  (error: unknown) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      (error as { response?: { status?: number; data?: unknown; config?: { url?: string; method?: string } } }).response
    ) {
      const axiosError = error as {
        response: { status: number; data: unknown };
        config: { url: string; method: string };
      };

      if (axiosError.response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return new Promise(() => {});
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;

// ── Shared request helpers ────────────────────────────────────────────────────
// Pre-production review item #78 — the QA / Form / Submission / CSR /
// AuditAssignment services were all repeating the same
// `try { axios.X } catch (e) { logError(...); throw e }` boilerplate. These
// helpers collapse that pattern so each service function is a one-liner and
// every failure is logged with a consistent `[<scope>] <METHOD> <url>` tag
// through the shared `logError` utility (dev-only, no-op in prod builds).
//
//   fetchCSRDashboardStats = () =>
//     apiGet<CSRDashboardStats>('csrService', '/csr/dashboard-stats');
//
// 401s are still handled centrally by the response interceptor above — these
// helpers re-throw so callers that need to render an error state still can.

/** Issue a GET and return `response.data`. Errors are logged via `logError` and re-thrown. */
export async function apiGet<T>(scope: string, url: string, config?: AxiosRequestConfig): Promise<T> {
  try {
    const res = await apiClient.get<T>(url, config);
    return res.data;
  } catch (error) {
    logError(scope, `GET ${url}`, error);
    throw error;
  }
}

/** Issue a POST and return `response.data`. Errors are logged via `logError` and re-thrown. */
export async function apiPost<T>(
  scope: string,
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await apiClient.post<T>(url, data, config);
    return res.data;
  } catch (error) {
    logError(scope, `POST ${url}`, error);
    throw error;
  }
}

/** Issue a PUT and return `response.data`. Errors are logged via `logError` and re-thrown. */
export async function apiPut<T>(
  scope: string,
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await apiClient.put<T>(url, data, config);
    return res.data;
  } catch (error) {
    logError(scope, `PUT ${url}`, error);
    throw error;
  }
}

/** Issue a PATCH and return `response.data`. Errors are logged via `logError` and re-thrown. */
export async function apiPatch<T>(
  scope: string,
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await apiClient.patch<T>(url, data, config);
    return res.data;
  } catch (error) {
    logError(scope, `PATCH ${url}`, error);
    throw error;
  }
}

/** Issue a DELETE and return `response.data`. Errors are logged via `logError` and re-thrown. */
export async function apiDelete<T>(scope: string, url: string, config?: AxiosRequestConfig): Promise<T> {
  try {
    const res = await apiClient.delete<T>(url, config);
    return res.data;
  } catch (error) {
    logError(scope, `DELETE ${url}`, error);
    throw error;
  }
}

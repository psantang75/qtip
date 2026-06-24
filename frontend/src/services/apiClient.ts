import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { getCookie } from '../utils/apiHelpers';
import { logError, logWarn } from '../utils/errorHandling';

/**
 * Single shared axios instance for the whole app.
 *
 * This used to be two divergent clients — `apiClient` (here) and `api`
 * (in authService.ts). They had *different* behavior: `api` did JWT
 * refresh-on-401 but no request de-duplication, while `apiClient` had a
 * de-dup wrapper that — because it overrode `.request` — never actually
 * intercepted `.get()` calls in axios 1.x. Maintaining two HTTP layers was
 * the real duplication smell, so they're now unified here. `authService`
 * re-exports this same instance as `api`, so every existing call site keeps
 * working unchanged while getting consistent auth + de-dup behavior.
 */

type DedupGetConfig = AxiosRequestConfig & { skipDedup?: boolean };

const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// ── In-flight GET de-duplication ───────────────────────────────────────────
// Collapses identical concurrent GETs (same url + sorted params) into a single
// network request. TanStack Query already de-dups same-key fetches; this is a
// second line of defense for non-RQ callers and for overlapping keys/components
// that request the same resource simultaneously.
//
// NOTE: we wrap `.get` specifically. In axios 1.x the prototype `get` calls the
// bound context's `request`, so overriding `apiClient.request` does NOT
// intercept `.get()` — which is why the previous wrapper was effectively dead
// code. Wrapping the method that callers actually use is the reliable approach.
const inflightGetMap = new Map<string, Promise<AxiosResponse>>();

const getSignature = (url: string, config?: AxiosRequestConfig): string => {
  const params = (config?.params || {}) as Record<string, unknown>;
  const orderedParams = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      const value = params[key];
      acc[key] = value === null || value === undefined ? '' : String(value);
      return acc;
    }, {});

  return `get:${url}?${JSON.stringify(orderedParams)}`;
};

const originalGet = apiClient.get.bind(apiClient) as typeof apiClient.get;

apiClient.get = function dedupedGet<T = unknown>(
  url: string,
  config?: DedupGetConfig,
): Promise<AxiosResponse<T>> {
  if (config?.skipDedup) {
    return originalGet<T>(url, config);
  }

  const signature = getSignature(url, config);
  const existing = inflightGetMap.get(signature);

  if (existing) {
    if (import.meta.env.DEV) {
      logWarn('apiClient', `[DEDUP] Reusing in-flight GET: ${url}`);
    }
    return existing as Promise<AxiosResponse<T>>;
  }

  const requestPromise = originalGet<T>(url, config).finally(() => {
    inflightGetMap.delete(signature);
  });

  inflightGetMap.set(signature, requestPromise as Promise<AxiosResponse>);
  return requestPromise;
} as typeof apiClient.get;

// ── Request interceptor: auth token, CSRF, FormData ─────────────────────────
apiClient.interceptors.request.use(
  (config) => {
    const url = config.url ?? '';
    const isPublicAuthEndpoint =
      url.includes('/auth/login') ||
      url.includes('/csrf-token') ||
      url.includes('/auth/forgot-password') ||
      url.includes('/auth/reset-password');

    if (!isPublicAuthEndpoint) {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
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
  (error: unknown) => Promise.reject(error),
);

// ── Response interceptor: JWT refresh-on-401, then redirect ─────────────────
function clearSessionAndRedirect(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('refreshToken');
  window.location.href = '/login';
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ code?: string }>) => {
    const originalRequest = error.config as
      | (typeof error.config & { _retry?: boolean })
      | undefined;

    if (error.response?.status === 401) {
      const isLoginAttempt = error.config?.url?.includes('/auth/login');

      if (!isLoginAttempt) {
        const errorCode = error.response.data?.code;

        // A blacklisted token can never be refreshed — bail straight to login.
        if (errorCode === 'TOKEN_BLACKLISTED') {
          clearSessionAndRedirect();
          return new Promise(() => {});
        }

        if (originalRequest && !originalRequest._retry) {
          originalRequest._retry = true;
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            try {
              const refreshResponse = await apiClient.post<{
                success: boolean;
                token: string;
                refreshToken?: string;
              }>('/auth/refresh-token', { refreshToken });

              if (refreshResponse.data.success) {
                const newToken = refreshResponse.data.token;
                localStorage.setItem('token', newToken);
                if (refreshResponse.data.refreshToken) {
                  localStorage.setItem('refreshToken', refreshResponse.data.refreshToken);
                }
                if (originalRequest.headers) {
                  originalRequest.headers.Authorization = `Bearer ${newToken}`;
                }
                return apiClient(originalRequest);
              }
            } catch {
              // refresh failed — fall through to redirect
            }
          }
        }

        clearSessionAndRedirect();
        return new Promise(() => {});
      }
    }

    return Promise.reject(error);
  },
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
// 401s are handled centrally by the response interceptor above (refresh, then
// redirect) — these helpers re-throw so callers that need an error state can.

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

import { config } from "../constants.js";

/** Error thrown for every failed API call. `message` is safe to show to users. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, details?: Record<string, string>}} [meta]
   */
  constructor(message, { status = 0, code = "UNKNOWN", details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_MESSAGES = {
  401: "Your session has expired. Sign in again to continue.",
  403: "You do not have permission to perform this action.",
  404: "The requested record is unavailable.",
  409: "This action conflicts with the current state. Refresh and try again.",
  422: "Some of the submitted details are invalid.",
};

/** Paths where a 401 is an expected answer rather than an expired session. */
const SILENT_401_PATHS = ["/auth/login", "/auth/me", "/auth/doctor/register", "/auth/patient/register"];

let unauthorizedHandler = null;

/** Registers a callback fired when any protected request returns 401. */
export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = handler;
};

function buildUrl(path, query) {
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== "" && value !== false && value != null) params.set(key, String(value));
  });
  const suffix = params.toString();
  return `${config.apiBaseUrl}${path}${suffix ? `?${suffix}` : ""}`;
}

/**
 * Low-level JSON request. Resolves with the parsed body (null for 204) or
 * rejects with an ApiError.
 * @param {string} path  Path relative to the API base URL, starting with "/".
 * @param {{method?: string, body?: unknown, query?: object, headers?: object, signal?: AbortSignal}} [options]
 */
export async function request(path, options = {}) {
  const { method = "GET", body, query, headers, signal } = options;
  if (!config.apiBaseUrl) {
    throw new ApiError("Backend mode is enabled but VITE_API_BASE_URL is not configured.", {
      code: "CONFIG_ERROR",
    });
  }
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      credentials: config.sendCredentials ? "include" : "same-origin",
      headers: {
        Accept: "application/json",
        // The website's language, so the server writes its emails to this person in it.
        "X-Language":
          typeof document !== "undefined" && document.documentElement.dataset.language === "bn" ? "bn" : "en",
        ...(body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new ApiError("Unable to reach the Carewell server. Check your connection and try again.", {
      code: "NETWORK_ERROR",
    });
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && !SILENT_401_PATHS.includes(path)) unauthorizedHandler?.();
    throw new ApiError(
      payload?.message || DEFAULT_MESSAGES[response.status] || `Request failed (${response.status}).`,
      {
        status: response.status,
        code: payload?.code ?? `HTTP_${response.status}`,
        details: payload?.details,
      },
    );
  }
  return payload;
}

export const http = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};

export const segment = (value) => encodeURIComponent(value);

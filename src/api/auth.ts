export type AuthUser = {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  roles?: string[];
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
  expiresAt: string;
};

export const AUTH_TOKEN_KEY = 'vn_auth_token';
export const AUTH_USER_KEY = 'vn_auth_user';

let fetchInstalled = false;

function apiData(json: any) {
  return json?.data ?? json;
}

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthSession(response: AuthResponse) {
  localStorage.setItem(AUTH_TOKEN_KEY, response.token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(response.user));
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) as AuthUser : null;
  } catch {
    localStorage.removeItem(AUTH_USER_KEY);
    return null;
  }
}

function shouldAttachAuth(input: RequestInfo | URL) {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/v1/');
  } catch {
    return raw.startsWith('/api/v1/');
  }
}

export function installAuthFetchInterceptor() {
  if (fetchInstalled || typeof window === 'undefined') return;
  fetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = getAuthToken();
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (token && shouldAttachAuth(input) && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await nativeFetch(input, { ...init, headers });
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('vn-auth-expired'));
    }
    return response;
  };
}

async function fetchJson(path: string, options: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(options.headers);
  const init: RequestInit = {
    ...options,
    headers
  };

  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.json);
  }
  delete (init as RequestInit & { json?: unknown }).json;

  const response = await fetch(path, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (typeof json?.code === 'number' && json.code !== 0)) {
    throw new Error(json?.message || `Request failed: ${response.status}`);
  }
  return apiData(json);
}

export async function registerUser(payload: {
  username: string;
  email?: string;
  displayName?: string;
  password: string;
}): Promise<AuthResponse> {
  return fetchJson('/api/v1/auth/register', {
    method: 'POST',
    json: payload
  });
}

export async function loginUser(payload: {
  identifier: string;
  password: string;
}): Promise<AuthResponse> {
  return fetchJson('/api/v1/auth/login', {
    method: 'POST',
    json: payload
  });
}

export async function loadCurrentUser(): Promise<AuthUser | null> {
  const data = await fetchJson('/api/v1/auth/me', { cache: 'no-store' });
  return data?.authenticated ? data.user as AuthUser : null;
}

export async function logoutUser(): Promise<void> {
  await fetchJson('/api/v1/auth/logout', { method: 'POST' });
}

/** Same-origin в prod (nginx проксирует /auth, /rooms); в dev — Vite proxy. */
function resolveApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return import.meta.env.DEV ? '/api' : '';
}

const API_URL = resolveApiBase();

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | null;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => undefined)) as
      | { message?: string | string[] }
      | undefined;

    const message = Array.isArray(errorBody?.message)
      ? errorBody.message.join(', ')
      : errorBody?.message || 'Request failed.';

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function getApiUrl() {
  return API_URL;
}

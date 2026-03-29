/** Same-origin в prod (nginx проксирует /auth, /rooms); в dev — Vite proxy. */
function resolveApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return import.meta.env.DEV ? '/api' : '';
}

const API_URL = resolveApiBase();

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  token?: string | null;
  extraHeaders?: Record<string, string>;
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
      ...(options.extraHeaders ?? {}),
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

export type PresignCanvasUploadResponse = {
  method: 'PUT';
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
  key: string;
};

export async function presignRoomCanvasUpload(
  slug: string,
  sessionId: string,
  body: { contentType: string; fileName: string; fileSize: number },
  token?: string | null,
): Promise<PresignCanvasUploadResponse> {
  return apiRequest<PresignCanvasUploadResponse>(
    `/rooms/${encodeURIComponent(slug)}/uploads/presign`,
    {
      method: 'POST',
      body,
      token,
      extraHeaders: {
        'X-Room-Session-Id': sessionId,
      },
    },
  );
}

/** Upload image via backend (no S3 CORS). Same auth as presign. */
export async function uploadRoomCanvasImage(
  slug: string,
  sessionId: string,
  file: File,
  token?: string | null,
): Promise<{ publicUrl: string; key: string }> {
  const form = new FormData();
  form.append('file', file, file.name);

  const response = await fetch(
    `${API_URL}/rooms/${encodeURIComponent(slug)}/uploads/image`,
    {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Room-Session-Id': sessionId,
      },
      body: form,
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => undefined)) as
      | { message?: string | string[] }
      | undefined;

    const message = Array.isArray(errorBody?.message)
      ? errorBody.message.join(', ')
      : errorBody?.message || `Upload failed (${response.status}).`;

    throw new Error(message);
  }

  return (await response.json()) as { publicUrl: string; key: string };
}

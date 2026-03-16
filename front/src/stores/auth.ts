import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { apiRequest } from '../lib/api';
import type { AuthResponse, User } from '../types';

const STORAGE_KEY = 'dnd-canvas-auth';

type StoredAuthState = {
  accessToken: string;
  user: User;
};

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<User | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function hydrate() {
    const rawState = localStorage.getItem(STORAGE_KEY);

    if (!rawState) {
      return;
    }

    try {
      const parsed = JSON.parse(rawState) as StoredAuthState;
      accessToken.value = parsed.accessToken;
      user.value = parsed.user;
    } catch {
      clearSession();
    }
  }

  async function register(payload: {
    email: string;
    displayName: string;
    password: string;
  }) {
    loading.value = true;
    error.value = null;

    try {
      const result = await apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: payload,
      });
      persistSession(result);
    } catch (caughtError) {
      error.value =
        caughtError instanceof Error ? caughtError.message : 'Registration failed.';
      throw caughtError;
    } finally {
      loading.value = false;
    }
  }

  async function login(payload: { email: string; password: string }) {
    loading.value = true;
    error.value = null;

    try {
      const result = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: payload,
      });
      persistSession(result);
    } catch (caughtError) {
      error.value =
        caughtError instanceof Error ? caughtError.message : 'Login failed.';
      throw caughtError;
    } finally {
      loading.value = false;
    }
  }

  async function fetchMe() {
    if (!accessToken.value) {
      return;
    }

    try {
      const response = await apiRequest<{ user: User }>('/auth/me', {
        token: accessToken.value,
      });
      user.value = response.user;
      persistLocalState();
    } catch {
      clearSession();
    }
  }

  function logout() {
    clearSession();
  }

  function persistSession(response: AuthResponse) {
    accessToken.value = response.accessToken;
    user.value = response.user;
    persistLocalState();
  }

  function persistLocalState() {
    if (!accessToken.value || !user.value) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        accessToken: accessToken.value,
        user: user.value,
      } satisfies StoredAuthState),
    );
  }

  function clearSession() {
    accessToken.value = null;
    user.value = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value));

  return {
    accessToken,
    error,
    hydrate,
    fetchMe,
    isAuthenticated,
    loading,
    login,
    logout,
    register,
    user,
  };
});

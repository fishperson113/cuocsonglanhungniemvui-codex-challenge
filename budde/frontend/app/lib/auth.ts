"use client";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  disabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function saveAuth(auth: AuthResponse): void {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.message ?? `HTTP ${res.status}`;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const auth: AuthResponse = await res.json();
  saveAuth(auth);
  return auth;
}

export async function register(
  email: string,
  password: string,
  name: string,
  role: "admin" | "user" = "user",
): Promise<AuthResponse> {
  const res = await fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name, role }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const auth: AuthResponse = await res.json();
  saveAuth(auth);
  return auth;
}

export async function fetchSession(): Promise<User | null> {
  const token = getToken();
  if (!token) return null;
  const res = await fetch("/auth/session", { headers: authHeaders() });
  if (!res.ok) return null;
  const data: { user: User } = await res.json();
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  clearAuth();
}

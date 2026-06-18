/**
 * WHAT: Thin HTTP client — all backend API calls go through this module.
 * WHY: Centralizes base URL, auth headers, and error handling in one place.
 * BREAKS IF REMOVED: Components make raw fetch calls with hardcoded URLs — chaos at scale.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// --- Auth token storage ---

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mizan_token");
}

export function setToken(token: string): void {
  localStorage.setItem("mizan_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("mizan_token");
  localStorage.removeItem("mizan_user");
}

export interface StoredUser {
  id: string;
  email: string;
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("mizan_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser): void {
  localStorage.setItem("mizan_user", JSON.stringify(user));
}

// --- Helper: normalize FastAPI error detail (string or Pydantic validation array) ---

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string };
    return first?.msg ?? fallback;
  }
  return fallback;
}

// --- Helper: authenticated fetch ---

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// --- Response types ---

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
}

export interface UploadResponse {
  job_id: string;
  filename: string;
  transaction_count: number;
  message: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: string;
  transaction_type: string;
  description: string;
  transaction_date: string;
  category: string | null;
  behavioral_tag: string | null;
  created_at: string;
}

export interface InsightResponse {
  user_id: string;
  transaction_count: number;
  insight: string;
  cached: boolean;
}

export interface NoteResponse {
  id: string;
  transaction_id: string;
  note_text: string;
  created_at: string;
}

export interface CategoryPatchResponse {
  id: string;
  category: string;
  old_category: string | null;
}

// --- API functions ---

export async function checkHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) throw new Error(`Health check failed with status ${response.status}`);
  return response.json() as Promise<HealthResponse>;
}

export async function register(email: string, password: string): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(body, "Kayıt başarısız oldu"));
  }
  return response.json() as Promise<TokenResponse>;
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(body, "Giriş başarısız oldu"));
  }
  return response.json() as Promise<TokenResponse>;
}

export async function uploadStatement(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error((error as { detail: string }).detail ?? "Upload failed");
  }
  return response.json() as Promise<UploadResponse>;
}

export async function getTransactions(): Promise<Transaction[]> {
  const response = await fetch(`${API_BASE_URL}/transactions`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch transactions: ${response.status}`);
  return response.json() as Promise<Transaction[]>;
}

export async function getInsights(): Promise<InsightResponse> {
  const response = await fetch(`${API_BASE_URL}/insights`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch insights: ${response.status}`);
  return response.json() as Promise<InsightResponse>;
}

export async function addNote(transactionId: string, noteText: string): Promise<NoteResponse> {
  const response = await fetch(`${API_BASE_URL}/transactions/${transactionId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ note_text: noteText }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to save note" }));
    throw new Error((error as { detail: string }).detail ?? "Failed to save note");
  }
  return response.json() as Promise<NoteResponse>;
}

export async function getNotes(transactionId: string): Promise<NoteResponse[]> {
  const response = await fetch(`${API_BASE_URL}/transactions/${transactionId}/notes`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch notes: ${response.status}`);
  return response.json() as Promise<NoteResponse[]>;
}

export async function correctCategory(
  transactionId: string,
  category: string,
): Promise<CategoryPatchResponse> {
  const response = await fetch(`${API_BASE_URL}/transactions/${transactionId}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ category }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to update category" }));
    throw new Error((error as { detail: string }).detail ?? "Failed to update category");
  }
  return response.json() as Promise<CategoryPatchResponse>;
}

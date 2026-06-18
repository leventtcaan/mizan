/**
 * WHAT: Thin HTTP client — all backend API calls go through this module.
 * WHY: Centralizes base URL, error handling, and future auth headers in one place.
 *      Adding a JWT header in Phase 2 means touching one file, not every component.
 * BREAKS IF REMOVED: Components make raw fetch calls with hardcoded URLs — chaos at scale.
 */

// WHY: NEXT_PUBLIC_ prefix exposes this env var to the browser bundle.
// Without it, the var is server-only and undefined in client components.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// WHY: Hardcoded dev seed UUID matches the user created by _seed_dev_user() in main.py.
// Replaced by JWT-extracted identity in Phase 4 (auth).
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
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
}

/**
 * WHAT: Calls GET /health and returns the parsed JSON response.
 * WHY: Used by the landing page to show real-time backend connectivity status.
 * BREAKS IF REMOVED: Landing page has no way to test backend connection.
 */
export async function checkHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

/**
 * WHAT: Posts a bank statement file to POST /upload, returns job_id and transaction count.
 * WHY: FormData is the only way to send binary file data over HTTP; JSON can't encode bytes.
 * BREAKS IF REMOVED: Upload page has no backend connection.
 */
export async function uploadStatement(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error((error as { detail: string }).detail ?? "Upload failed");
  }
  return response.json() as Promise<UploadResponse>;
}

/**
 * WHAT: Fetches all transactions for the given user from GET /transactions.
 * WHY: Centralised so transaction_date parsing and error handling live in one place.
 * BREAKS IF REMOVED: Transactions page has no data source.
 */
export async function getTransactions(userId: string): Promise<Transaction[]> {
  const response = await fetch(
    `${API_BASE_URL}/transactions?user_id=${encodeURIComponent(userId)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch transactions: ${response.status}`);
  }
  return response.json() as Promise<Transaction[]>;
}

/**
 * WHAT: Fetches behavioral coaching insight for the given user from GET /insights.
 * WHY: Keeps the LLM call server-side — API key never touches the browser.
 * BREAKS IF REMOVED: Insights page has no coaching data.
 */
export async function getInsights(userId: string): Promise<InsightResponse> {
  const response = await fetch(
    `${API_BASE_URL}/insights?user_id=${encodeURIComponent(userId)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch insights: ${response.status}`);
  }
  return response.json() as Promise<InsightResponse>;
}

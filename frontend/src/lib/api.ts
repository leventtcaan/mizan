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

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
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

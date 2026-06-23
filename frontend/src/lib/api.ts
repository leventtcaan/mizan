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
  onboarding_completed: boolean;
  language: string;
  display_currency?: string;
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

export const CURRENCY_CHANGE_EVENT = "mizan-currency-change";

/** The user's preferred display currency — single source of truth across the app. */
export function getDefaultCurrency(): string {
  return getStoredUser()?.display_currency || "TRY";
}

/** Persist locally + broadcast so every open page updates without a reload. */
export function setDefaultCurrencyLocal(code: string): void {
  const user = getStoredUser();
  if (user) setStoredUser({ ...user, display_currency: code });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CURRENCY_CHANGE_EVENT, { detail: code }));
  }
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
  onboarding_completed: boolean;
  language: string;
  display_currency: string;
}

export interface UserResponse {
  user_id: string;
  email: string;
  onboarding_completed: boolean;
  language: string;
  display_currency: string;
  email_weekly_enabled: boolean;
}

export async function getMe(): Promise<UserResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
  return response.json() as Promise<UserResponse>;
}

export async function updatePreferences(prefs: {
  language?: string;
  email_weekly_enabled?: boolean;
  display_currency?: string;
}): Promise<UserResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(prefs),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Failed to update preferences"));
  }
  return response.json() as Promise<UserResponse>;
}

export interface SuggestionItem {
  id: string;
  suggestion_type: string;
  asset_id: string | null;
  suggested_change: string;
  currency: string;
  reason: string;
  source_batch_id: string | null;
  status: string;
  created_at: string;
}

export interface UploadResponse {
  job_id: string;
  filename: string;
  transaction_count: number;
  status: "success" | "empty" | "failed";
  reason: string | null;
  message: string;
  suggestions?: SuggestionItem[];
  parsed_income?: string;
  parsed_expenses?: string;
  currency?: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  transaction_type: string;
  description: string;
  transaction_date: string;
  category: string | null;
  behavioral_tag: string | null;
  source?: string;
  created_at: string;
}

// Post-Upload Brief — the narrative read of one uploaded statement.
export interface Brief {
  job_id: string;
  period: { start: string; end: string; transaction_count: number };
  flow: { income: number; expenses: number; net: number; currency: string };
  top_categories: { name: string; amount: number; share: number }[];
  largest_transaction: { description: string; amount: number; type: string } | null;
  recurring_signal: { monthly_total: number; highlight: string | null };
  suggested_action: { key: string; label: string; href: string };
  narrative: string | null;
}

export interface InsightResponse {
  user_id: string;
  transaction_count: number;
  insight: string;
  cached: boolean;
}

export interface BatchSummary {
  batch_id: string;
  uploaded_at: string;
  transaction_count: number;
  min_date: string;
  max_date: string;
}

export interface MonthlyTotal {
  month: string;
  total_spent: string;
  total_income: string;
  by_category: Record<string, string>;
}

export interface ProgressResponse {
  months: MonthlyTotal[];
  batch_count: number;
  total_transactions: number;
  min_date: string | null;
  max_date: string | null;
  cached: boolean;
}

export interface CategoryTrend {
  category: string;
  this_month: string;
  last_month: string;
  change_pct: number;
  trend: "up" | "down" | "same";
  insight: string;
}

export interface ComparisonResponse {
  this_month: string;
  last_month: string;
  categories: CategoryTrend[];
  cached: boolean;
}

// ── Financial Health scorecard (Progress page) ──────────────────────────────
export type PillarKey = "savings" | "debt" | "discipline" | "growth";
export type PillarTrend = "up" | "down" | "flat" | "none";

export interface ScorecardPillar {
  key: PillarKey;
  score: number;
  max: number;
  trend: PillarTrend;
  value: number;
  value2?: number;
  status: "ok" | "no_data" | "set_goals" | "need_history";
}

export interface TrajectoryPoint {
  date: string;
  net_worth: number;
}

export interface ScorecardAnnotation {
  date: string;
  direction: "up" | "down";
  amount: number;
  mover: string | null;
}

export interface ScorecardDriver {
  kind: "category" | "debt" | "income";
  name: string | null;
  amount: number;
}

export interface ScorecardMilestone {
  key: "debt_free" | "nw_target";
  status: "on_track" | "no_plan" | "stalled";
  date: string | null;
  months: number | null;
  target?: number;
}

export interface ScorecardStreak {
  category: string;
  months: number;
  current_pct: number;
  limit: number;
  spent: number;
}

export interface Scorecard {
  has_data: boolean;
  currency: string;
  score: number;
  score_delta: number | null;
  band: "strong" | "steady" | "fragile" | "at_risk";
  top_mover: { key: PillarKey; direction: "up" | "down" } | null;
  pillars: ScorecardPillar[];
  trajectory: TrajectoryPoint[];
  trajectory_estimated: boolean;
  annotations: ScorecardAnnotation[];
  drivers: { best: ScorecardDriver | null; worst: ScorecardDriver | null };
  milestones: ScorecardMilestone[];
  streaks: ScorecardStreak[];
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

// --- Onboarding analysis (AI first impression from the parsed statement) ---

export interface OnboardingAnalyzeRequest {
  has_statement: boolean;
  parsed_income?: number | null;
  parsed_expenses?: number | null;
  currency: string;
  lang: string;
}

export interface OnboardingAnalyzeResponse {
  summary: string | null;
}

export async function analyzeOnboarding(
  body: OnboardingAnalyzeRequest,
): Promise<OnboardingAnalyzeResponse> {
  const response = await fetch(`${API_BASE_URL}/onboarding/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Analysis failed"));
  }
  return response.json() as Promise<OnboardingAnalyzeResponse>;
}

export async function completeOnboarding(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/complete-onboarding`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("Failed to complete onboarding");
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

// Review & edit — one row of a parsed batch the user can correct before committing.
export interface ReviewTransaction {
  id: string | null;            // null → a new manual row to insert
  transaction_date: string;     // ISO yyyy-mm-dd
  description: string;
  amount: string;
  transaction_type: "debit" | "credit";
  category: string | null;
  currency: string;
}

export async function getReviewBatch(batchId: string): Promise<ReviewTransaction[]> {
  const response = await fetch(`${API_BASE_URL}/upload/review/${encodeURIComponent(batchId)}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to load batch: ${response.status}`);
  return response.json() as Promise<ReviewTransaction[]>;
}

export async function saveReviewBatch(
  batchId: string, transactions: ReviewTransaction[],
): Promise<ReviewTransaction[]> {
  const response = await fetch(`${API_BASE_URL}/upload/review/${encodeURIComponent(batchId)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ transactions }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Save failed" }));
    throw new Error((error as { detail: string }).detail ?? "Save failed");
  }
  return response.json() as Promise<ReviewTransaction[]>;
}

export async function getBrief(jobId: string, lang = "tr"): Promise<Brief> {
  const response = await fetch(
    `${API_BASE_URL}/upload/brief?job_id=${encodeURIComponent(jobId)}&lang=${lang}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`Failed to fetch brief: ${response.status}`);
  return response.json() as Promise<Brief>;
}

// ── Financial simulator ──────────────────────────────────────────────────────
export interface SimAction { type: string; amount: number; label?: string | null; debt_id?: string | null; }
export interface SimPoint { month: number; net_worth: number; liquid: number; low?: number; high?: number; }
export interface SimProjection {
  points: SimPoint[];
  net_worth_end: number; liquid_end: number;
  debt_free_month: number | null;
  total_interest: number; min_liquid: number; min_liquid_month: number;
}
export interface SimResult {
  currency: string;
  horizon_months: number;
  baseline: SimProjection;
  scenario: SimProjection;
  deltas: {
    net_worth_end: number; monthly_cashflow: number;
    debt_free_months: number; interest_saved: number; liquid_end: number;
  };
  warnings: string[];
  assumptions: string[];
  narrative: string | null;
  applied: string[];
}
export interface SimLevers {
  currency: string;
  net_worth: number; liquid: number; monthly_surplus: number;
  subscriptions: { key: string; label: string; monthly_amount: number }[];
  debts: { id: string; label: string; remaining: number; monthly_payment: number }[];
}
export interface SimAskResponse { parsed: boolean; actions: SimAction[]; result: SimResult | null; }

export async function getSimulatorLevers(displayCurrency = "TRY"): Promise<SimLevers> {
  const r = await fetch(`${API_BASE_URL}/simulator/levers?display_currency=${displayCurrency}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Failed to load levers: ${r.status}`);
  return r.json() as Promise<SimLevers>;
}

export async function runSimulator(
  actions: SimAction[], horizonMonths: number, displayCurrency = "TRY", lang = "tr",
): Promise<SimResult> {
  const r = await fetch(`${API_BASE_URL}/simulator/run?display_currency=${displayCurrency}&lang=${lang}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ actions, horizon_months: horizonMonths }),
  });
  if (!r.ok) throw new Error(`Simulation failed: ${r.status}`);
  return r.json() as Promise<SimResult>;
}

export async function askSimulator(
  question: string, horizonMonths: number, displayCurrency = "TRY", lang = "tr",
): Promise<SimAskResponse> {
  const r = await fetch(`${API_BASE_URL}/simulator/ask?display_currency=${displayCurrency}&lang=${lang}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ question, horizon_months: horizonMonths }),
  });
  if (!r.ok) throw new Error(`Simulation failed: ${r.status}`);
  return r.json() as Promise<SimAskResponse>;
}

// ── Financial report ─────────────────────────────────────────────────────────
export interface FinancialReport {
  meta: { generated_at: string; period_key: string; period_label: string; currency: string; lang: string };
  summary: string;
  net_worth: {
    total_assets: number; total_liabilities: number; net_worth: number; pending_receivables: number;
    opening: number | null; closing: number | null; change: number | null; estimated: boolean;
  };
  cash_flow: {
    income: number; expenses: number; net: number;
    top_categories: { name: string; amount: number; share: number }[];
  };
  assets: { name: string; type: string; value: number }[];
  liabilities: { name: string; remaining: number; monthly_payment: number; rate: number | null }[];
  receivables: { from_person: string; amount: number; expected_date: string | null }[];
  allocation: { name: string; value: number; share: number }[];
  currency_mix: { code: string; value: number; share: number }[];
  trajectory: { date: string; net_worth: number }[];
  recommendations: { title: string; detail: string }[];
  assumptions: string[];
}

export async function getFinancialReport(period: string, displayCurrency = "TRY", lang = "tr"): Promise<FinancialReport> {
  const r = await fetch(
    `${API_BASE_URL}/reports/financial?period=${period}&display_currency=${displayCurrency}&lang=${lang}`,
    { headers: authHeaders() },
  );
  if (!r.ok) throw new Error(`Failed to build report: ${r.status}`);
  return r.json() as Promise<FinancialReport>;
}

export async function downloadTransactionsCsv(period: string, displayCurrency = "TRY"): Promise<void> {
  const r = await fetch(
    `${API_BASE_URL}/reports/transactions.csv?period=${period}&display_currency=${displayCurrency}`,
    { headers: authHeaders() },
  );
  if (!r.ok) throw new Error(`Failed to export CSV: ${r.status}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mizan-transactions-${period}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function getBatches(): Promise<BatchSummary[]> {
  const response = await fetch(`${API_BASE_URL}/transactions/batches`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch batches: ${response.status}`);
  return response.json() as Promise<BatchSummary[]>;
}

export async function getTransactions(all = false): Promise<Transaction[]> {
  const url = all
    ? `${API_BASE_URL}/transactions?all=true`
    : `${API_BASE_URL}/transactions`;
  const response = await fetch(url, { headers: authHeaders() });
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

export async function getProgress(): Promise<ProgressResponse> {
  const response = await fetch(`${API_BASE_URL}/insights/progress`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch progress: ${response.status}`);
  return response.json() as Promise<ProgressResponse>;
}

export async function getScorecard(displayCurrency = "TRY"): Promise<Scorecard> {
  const response = await fetch(
    `${API_BASE_URL}/insights/scorecard?display_currency=${displayCurrency}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`Failed to fetch scorecard: ${response.status}`);
  return response.json() as Promise<Scorecard>;
}

export async function getComparison(): Promise<ComparisonResponse> {
  const response = await fetch(`${API_BASE_URL}/insights/comparison`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch comparison: ${response.status}`);
  return response.json() as Promise<ComparisonResponse>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface PendingTransaction {
  amount: string;
  type: "debit" | "credit";
  description: string;
  date: string;
  category: string;
}

export interface ChatApiResponse {
  response: string;
  profile_updated: boolean;
  pending_transaction: PendingTransaction | null;
}

export interface BehavioralProfile {
  fixed_expenses: Record<string, number>;
  income_sources: Record<string, number>;
  spending_patterns: Record<string, boolean>;
  user_notes: string;
  updated_at: string | null;
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  const response = await fetch(`${API_BASE_URL}/chat/history`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch chat history: ${response.status}`);
  return response.json() as Promise<ChatMessage[]>;
}

export async function sendChatMessage(message: string): Promise<ChatApiResponse> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Mesaj gönderilemedi"));
  }
  return response.json() as Promise<ChatApiResponse>;
}

export async function getChatProfile(): Promise<BehavioralProfile> {
  const response = await fetch(`${API_BASE_URL}/chat/profile`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch profile: ${response.status}`);
  return response.json() as Promise<BehavioralProfile>;
}

export interface GoalResponse {
  id: string;
  category: string;
  monthly_limit: string;
  created_at: string;
}

export interface GoalStatusItem {
  category: string;
  monthly_limit: string;
  spent_this_month: string;
  remaining: string;
  pct_used: number;
  status: "ok" | "warning" | "exceeded";
}

export async function getGoals(): Promise<GoalResponse[]> {
  const response = await fetch(`${API_BASE_URL}/goals`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch goals: ${response.status}`);
  return response.json() as Promise<GoalResponse[]>;
}

export async function upsertGoal(category: string, monthly_limit: string): Promise<GoalResponse> {
  const response = await fetch(`${API_BASE_URL}/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ category, monthly_limit }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Hedef kaydedilemedi"));
  }
  return response.json() as Promise<GoalResponse>;
}

export async function deleteGoal(category: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/goals/${category}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to delete goal: ${response.status}`);
}

export async function getGoalStatus(): Promise<GoalStatusItem[]> {
  const response = await fetch(`${API_BASE_URL}/goals/status`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch goal status: ${response.status}`);
  return response.json() as Promise<GoalStatusItem[]>;
}

export type TransactionSource =
  | "manual" | "user_estimate" | "user_confirmed" | "user_supplementary";

export interface CreateTransactionRequest {
  amount: string;
  transaction_type: "debit" | "credit";
  description: string;
  transaction_date: string;
  category?: string;
  currency?: string;
  source?: TransactionSource;
}

export async function createTransaction(body: CreateTransactionRequest): Promise<Transaction> {
  const response = await fetch(`${API_BASE_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "İşlem eklenemedi"));
  }
  return response.json() as Promise<Transaction>;
}

export interface PersonalityData {
  type: string;
  description: string;
  strengths: string[];
  watch_out: string[];
  tip: string;
  cached: boolean;
}

export async function getPersonality(): Promise<PersonalityData> {
  const response = await fetch(`${API_BASE_URL}/personality`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch personality: ${response.status}`);
  return response.json() as Promise<PersonalityData>;
}

export interface Alert {
  type: string;
  message: string;
  amount: string;
  actionable: boolean;
  dismiss_key: string;
}

export async function getAlerts(): Promise<Alert[]> {
  const response = await fetch(`${API_BASE_URL}/patterns/alerts`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch alerts: ${response.status}`);
  return response.json() as Promise<Alert[]>;
}

export async function dismissAlert(dismissKey: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/patterns/alerts/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ dismiss_key: dismissKey }),
  });
  if (!response.ok) throw new Error(`Failed to dismiss alert: ${response.status}`);
}

export interface CategoryInflation {
  category: string;
  old_avg: number;
  new_avg: number;
  old_month: string;
  new_month: string;
  nominal_pct: number;
  inflation_pct: number;
  real_pct: number;
  verdict: string;
  months_compared: number;
}

export interface InflationResponse {
  analyses: CategoryInflation[];
  cached: boolean;
}

export async function getInflationAnalysis(): Promise<InflationResponse> {
  const response = await fetch(`${API_BASE_URL}/inflation/analysis`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch inflation analysis: ${response.status}`);
  return response.json() as Promise<InflationResponse>;
}

export interface EmailPreferences {
  email_weekly_enabled: boolean;
}

export async function getEmailPreferences(): Promise<EmailPreferences> {
  const response = await fetch(`${API_BASE_URL}/email/preferences`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch email preferences: ${response.status}`);
  return response.json() as Promise<EmailPreferences>;
}

export async function setEmailPreferences(enabled: boolean): Promise<EmailPreferences> {
  const response = await fetch(`${API_BASE_URL}/email/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email_weekly_enabled: enabled }),
  });
  if (!response.ok) throw new Error(`Failed to update email preferences: ${response.status}`);
  return response.json() as Promise<EmailPreferences>;
}

export async function getWeeklyPreview(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/email/weekly-preview`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to generate preview: ${response.status}`);
  const data = (await response.json()) as { html: string };
  return data.html;
}

export interface SendEmailResponse {
  message: string;
  email_id: string | null;
}

export async function sendWeeklySummary(): Promise<SendEmailResponse> {
  const response = await fetch(`${API_BASE_URL}/email/weekly-send`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "E-posta gönderilemedi"));
  }
  return response.json() as Promise<SendEmailResponse>;
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

// --- Subscriptions ---

export async function flagSubscription(
  merchant_key: string,
  flag: "essential" | "review" | "cancelled",
): Promise<{ merchant_key: string; flag: string }> {
  const response = await fetch(`${API_BASE_URL}/subscriptions/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ merchant_key, flag }),
  });
  if (!response.ok) throw new Error(`Failed to flag subscription: ${response.status}`);
  return response.json() as Promise<{ merchant_key: string; flag: string }>;
}

// --- Unified recurring commitments (subscriptions + installments, de-duplicated) ---

export interface RecurringSubscription {
  merchant_key: string;
  merchant: string;
  avg_amount: string;
  currency: string;
  frequency: string;
  last_seen: string;
  total_paid_all_time: string;
  months_active: number;
  category: string;
  flag: string | null;
}

export interface RecurringInstallment {
  merchant_key: string;
  merchant: string;
  currency: string;
  monthly_amount: number;
  months_detected: number;
  estimated_remaining: number;
  total_plan_months: number;
  total_paid: number;
  estimated_total: number;
  first_seen: string;
  last_seen: string;
  category: string;
  source: string;
  total_nominal: number;
  opportunity_loss: number;
  real_cost_with_opportunity: number;
}

export interface RecurringSummary {
  monthly_total: string;
  subscription_monthly: string;
  installment_monthly: string;
  subscription_count: number;
  installment_count: number;
  potential_savings: string;
  months_until_debt_free: number;
  total_opportunity_loss: number;
}

export interface RecurringResponse {
  subscriptions: RecurringSubscription[];
  installments: RecurringInstallment[];
  summary: RecurringSummary;
}

export async function getRecurring(displayCurrency = "TRY"): Promise<RecurringResponse> {
  const response = await fetch(`${API_BASE_URL}/recurring?display_currency=${displayCurrency}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch recurring: ${response.status}`);
  return response.json() as Promise<RecurringResponse>;
}

// --- Net Worth ---

export interface AssetItem {
  id: string;
  name: string;
  asset_type: string;
  currency: string;
  current_value: string;
  notes: string | null;
  source: string;
  source_detail: string | null;
  as_of_date: string;
  quantity: string | null;
  unit_code: string | null;
  account_id: string | null;
  created_at: string;
  updated_at: string;
}

// --- Accounts (where money lives) ---

export interface Account {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  institution: string | null;
}

export async function getAccounts(): Promise<Account[]> {
  const response = await fetch(`${API_BASE_URL}/accounts`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch accounts: ${response.status}`);
  return response.json() as Promise<Account[]>;
}

export async function createAccount(body: {
  name: string; account_type?: string; currency?: string; institution?: string;
}): Promise<Account> {
  const response = await fetch(`${API_BASE_URL}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Account could not be created"));
  }
  return response.json() as Promise<Account>;
}

export async function deleteAccount(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/accounts/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to delete account: ${response.status}`);
}

export interface LiabilityItem {
  id: string;
  name: string;
  liability_type: string;
  currency: string;
  total_amount: string;
  remaining_amount: string;
  monthly_payment: string | null;
  due_date: string | null;
  interest_rate: string | null;
  notes: string | null;
  created_at: string;
}

export interface ReceivableItem {
  id: string;
  linked_asset_id: string | null;
  from_person: string;
  amount: string;
  currency: string;
  expected_date: string | null;
  notes: string | null;
  status: "pending" | "received" | "overdue" | "written_off";
  created_at: string;
}

export interface NetWorthSummary {
  total_assets_try: number;
  total_liabilities_try: number;
  net_worth_try: number;
  assets_by_type: Record<string, number>;
  liabilities_by_type: Record<string, number>;
  pending_receivables_try: number;
  currency_breakdown: Record<string, number>;
  warnings: string[];
  ai_insight: string | null;
}

export async function getNetWorthSummary(displayCurrency = "TRY"): Promise<NetWorthSummary> {
  const response = await fetch(
    `${API_BASE_URL}/networth/summary?display_currency=${displayCurrency}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`Failed to fetch net worth summary: ${response.status}`);
  return response.json() as Promise<NetWorthSummary>;
}

// ── Net Worth AI guidance ───────────────────────────────────────────────────
export interface GuidanceAction {
  type: "discuss" | "set_goal" | "create_alert" | "refresh_prices" | "add_liability";
  params: Record<string, string>;
}

export interface GuidanceFinding {
  id: string;
  play: string;
  severity: "high" | "medium" | "low";
  observation: string;
  context: string;
  why: string;
  move: string;
  action: GuidanceAction | null;
}

export interface GuidanceResponse {
  findings: GuidanceFinding[];
  cached: boolean;
}

export async function getNetWorthGuidance(displayCurrency = "TRY", lang = "tr"): Promise<GuidanceResponse> {
  const response = await fetch(
    `${API_BASE_URL}/networth/guidance?display_currency=${displayCurrency}&lang=${lang}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`Failed to fetch guidance: ${response.status}`);
  return response.json() as Promise<GuidanceResponse>;
}

export async function getAssets(): Promise<AssetItem[]> {
  const response = await fetch(`${API_BASE_URL}/networth/assets`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch assets: ${response.status}`);
  return response.json() as Promise<AssetItem[]>;
}

export async function createAsset(body: {
  name: string; asset_type: string; currency: string; current_value: string;
  notes?: string; source?: string; source_detail?: string; as_of_date?: string;
  quantity?: string; unit_code?: string; account_id?: string;
}): Promise<AssetItem> {
  const response = await fetch(`${API_BASE_URL}/networth/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Varlık eklenemedi"));
  }
  return response.json() as Promise<AssetItem>;
}

export async function updateAsset(id: string, body: {
  name: string; asset_type: string; currency: string; current_value: string; notes?: string; source_detail?: string; as_of_date?: string;
  quantity?: string; unit_code?: string; account_id?: string;
}): Promise<AssetItem> {
  const response = await fetch(`${API_BASE_URL}/networth/assets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Varlık güncellenemedi"));
  }
  return response.json() as Promise<AssetItem>;
}

export async function deleteAsset(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/networth/assets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to delete asset: ${response.status}`);
}

export interface RefreshPricesResult {
  updated: number;
  failed: number;
  details: { asset_id: string; name: string; asset_type: string; status: "updated" | "failed"; price_usd?: number }[];
}

export async function refreshAssetPrices(): Promise<RefreshPricesResult> {
  const response = await fetch(`${API_BASE_URL}/networth/assets/refresh-prices`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to refresh prices: ${response.status}`);
  return response.json() as Promise<RefreshPricesResult>;
}

export async function getLiabilities(): Promise<LiabilityItem[]> {
  const response = await fetch(`${API_BASE_URL}/networth/liabilities`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch liabilities: ${response.status}`);
  return response.json() as Promise<LiabilityItem[]>;
}

export async function createLiability(body: {
  name: string; liability_type: string; currency: string;
  total_amount: string; remaining_amount: string;
  monthly_payment?: string; due_date?: string; interest_rate?: string; notes?: string;
}): Promise<LiabilityItem> {
  const response = await fetch(`${API_BASE_URL}/networth/liabilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Borç eklenemedi"));
  }
  return response.json() as Promise<LiabilityItem>;
}

export async function updateLiability(id: string, body: {
  name: string; liability_type: string; currency: string;
  total_amount: string; remaining_amount: string;
  monthly_payment?: string; due_date?: string; interest_rate?: string; notes?: string;
}): Promise<LiabilityItem> {
  const response = await fetch(`${API_BASE_URL}/networth/liabilities/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Borç güncellenemedi"));
  }
  return response.json() as Promise<LiabilityItem>;
}

export async function deleteLiability(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/networth/liabilities/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to delete liability: ${response.status}`);
}

export async function getReceivables(): Promise<ReceivableItem[]> {
  const response = await fetch(`${API_BASE_URL}/networth/receivables`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch receivables: ${response.status}`);
  return response.json() as Promise<ReceivableItem[]>;
}

export async function createReceivable(body: {
  from_person: string; amount: string; currency: string; expected_date?: string; notes?: string;
}): Promise<ReceivableItem> {
  const response = await fetch(`${API_BASE_URL}/networth/receivables`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Alacak eklenemedi"));
  }
  return response.json() as Promise<ReceivableItem>;
}

export interface StatusPatchResponse {
  receivable: ReceivableItem;
  created_asset: AssetItem | null;
  toast_message: string | null;
}

export async function updateReceivableStatus(
  id: string,
  status: "pending" | "received" | "overdue" | "written_off",
): Promise<StatusPatchResponse> {
  const response = await fetch(`${API_BASE_URL}/networth/receivables/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`Failed to update receivable: ${response.status}`);
  return response.json() as Promise<StatusPatchResponse>;
}

export async function deleteReceivable(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/networth/receivables/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to delete receivable: ${response.status}`);
}

// --- Net Worth Suggestions ---

export async function getNetWorthSuggestions(): Promise<SuggestionItem[]> {
  const response = await fetch(`${API_BASE_URL}/networth/suggestions`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch suggestions: ${response.status}`);
  return response.json() as Promise<SuggestionItem[]>;
}

export async function acceptSuggestion(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/networth/suggestions/${id}/accept`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to accept suggestion: ${response.status}`);
}

export async function dismissSuggestion(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/networth/suggestions/${id}/dismiss`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to dismiss suggestion: ${response.status}`);
}

// --- Currency ---

export interface CurrencyEntry {
  code: string;
  name: string;
  usd_price?: number;
}

export interface CurrencyList {
  fiat: CurrencyEntry[];
  crypto: CurrencyEntry[];
  commodities: CurrencyEntry[];
}

export async function getCurrencyList(): Promise<CurrencyList> {
  const response = await fetch(`${API_BASE_URL}/currency/list`);
  if (!response.ok) throw new Error(`Failed to fetch currency list: ${response.status}`);
  return response.json() as Promise<CurrencyList>;
}

export async function getCurrencyRates(base = "TRY"): Promise<Record<string, number>> {
  const response = await fetch(`${API_BASE_URL}/currency/rates?base=${base}`);
  if (!response.ok) throw new Error(`Failed to fetch currency rates: ${response.status}`);
  const data = (await response.json()) as { rates: Record<string, number> };
  return data.rates;
}

export interface MarketQuote {
  symbol: string;
  yahoo_symbol: string;
  price: number | null;
  currency: string | null;
  name: string | null;
}

/**
 * Live price for a stock ticker / ETF / fund.
 * exchange: AUTO | BIST | LSE | XETRA | TSX | ASX
 * Returns price = null on any lookup failure; caller falls back to manual entry.
 */
export interface TefasFund {
  code: string;
  nav: number | null;
  name: string | null;
  currency: string;
}

export async function getTefasFund(code: string): Promise<TefasFund> {
  const url = `${API_BASE_URL}/currency/fund?code=${encodeURIComponent(code)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TEFAS fetch failed: ${response.status}`);
  return response.json() as Promise<TefasFund>;
}

export async function getMarketQuote(symbol: string, exchange = "AUTO"): Promise<MarketQuote> {
  const url = `${API_BASE_URL}/currency/quote?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch quote: ${response.status}`);
  return response.json() as Promise<MarketQuote>;
}

// --- Reconciliation ---

export interface FinancialEventItem {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  amount: string | null;
  currency: string | null;
  event_date: string;
  source: string;
  source_detail: Record<string, unknown> | string | null;
  status: string;
  confidence: string | null;
  created_at: string;
}

export interface ReconciliationItem {
  id: string;
  issue_type: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved" | "dismissed";
  title: string;
  description: string;
  related_event_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  proposed_action: Record<string, unknown> | string | null;
  created_at: string;
  resolved_at: string | null;
}

export async function getFinancialEvents(limit = 100): Promise<FinancialEventItem[]> {
  const response = await fetch(`${API_BASE_URL}/reconciliation/events?limit=${limit}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch financial events: ${response.status}`);
  return response.json() as Promise<FinancialEventItem[]>;
}

export async function getReconciliationItems(status = "open"): Promise<ReconciliationItem[]> {
  const response = await fetch(`${API_BASE_URL}/reconciliation/items?status=${status}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch reconciliation items: ${response.status}`);
  return response.json() as Promise<ReconciliationItem[]>;
}

export async function scanReconciliation(): Promise<{ created: number }> {
  const response = await fetch(`${API_BASE_URL}/reconciliation/scan`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to scan reconciliation items: ${response.status}`);
  return response.json() as Promise<{ created: number }>;
}

export async function updateReconciliationItemStatus(
  id: string,
  status: "open" | "resolved" | "dismissed",
): Promise<ReconciliationItem> {
  const response = await fetch(`${API_BASE_URL}/reconciliation/items/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`Failed to update reconciliation item: ${response.status}`);
  return response.json() as Promise<ReconciliationItem>;
}

export async function deleteBatch(batchId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/transactions/batch/${batchId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to delete batch: ${response.status}`);
}

// --- Cash Flow ---

export interface CashFlowItem {
  date: string;
  type: "liability_payment" | "income" | "subscription" | "recurring_income";
  amount: string;
  currency: string;
  description: string;
  source: "liability" | "receivable" | "subscription" | "recurring_income";
  urgent: boolean;
  overdue: boolean;
}

export interface CashFlowSummary {
  total_expected_income: string;
  total_expected_payments: string;
  projected_net: string;
  liquid_assets: string;
  display_currency: string;
  liquid_to_payments_ratio: number | null;
  warning: string | null;
  days: number;
  month_income_actual: string;
  month_expenses_actual: string;
  expected_income_rest: string;
  expected_payments_rest: string;
  projected_month_end: string;
}

export async function getCashFlowUpcoming(days = 30, displayCurrency = "TRY"): Promise<CashFlowItem[]> {
  const response = await fetch(
    `${API_BASE_URL}/cashflow/upcoming?days=${days}&display_currency=${displayCurrency}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`Failed to fetch cashflow: ${response.status}`);
  return response.json() as Promise<CashFlowItem[]>;
}

export async function getCashFlowSummary(days = 30, displayCurrency = "TRY"): Promise<CashFlowSummary> {
  const response = await fetch(
    `${API_BASE_URL}/cashflow/summary?days=${days}&display_currency=${displayCurrency}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`Failed to fetch cashflow summary: ${response.status}`);
  return response.json() as Promise<CashFlowSummary>;
}

// --- Net Worth Snapshots ---

export interface NetworthSnapshot {
  id: string;
  net_worth_usd: string;
  assets_usd: string;
  liabilities_usd: string;
  recorded_at: string;
  estimated?: boolean;
}

export async function createNetWorthSnapshot(): Promise<NetworthSnapshot> {
  const response = await fetch(`${API_BASE_URL}/networth/snapshot`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to create snapshot: ${response.status}`);
  return response.json() as Promise<NetworthSnapshot>;
}

export async function getNetWorthHistory(days = 90): Promise<NetworthSnapshot[]> {
  const response = await fetch(`${API_BASE_URL}/networth/history?days=${days}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch net worth history: ${response.status}`);
  return response.json() as Promise<NetworthSnapshot[]>;
}

// --- Net Worth Change Attribution ("why did it move") ---

export interface AttributionDriver {
  label: string;
  kind: string;
  amount: number;
  direction: "up" | "down";
}

export interface NetWorthAttribution {
  period_days: number;
  delta: number;
  currency: string;
  drivers: AttributionDriver[];
}

export async function getNetWorthAttribution(displayCurrency = "TRY"): Promise<NetWorthAttribution | null> {
  const response = await fetch(`${API_BASE_URL}/networth/attribution?display_currency=${displayCurrency}`, {
    headers: authHeaders(),
  });
  if (!response.ok) return null;
  return response.json() as Promise<NetWorthAttribution | null>;
}

// --- Wealth Alerts ---

export interface WealthAlertItem {
  id: string;
  alert_type: string;
  condition_json: string;
  message_template: string;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string;
  asset_id: string | null;
  threshold_usd: number | null;
}

export interface TriggeredWealthAlert {
  alert: WealthAlertItem;
  triggered_reason: string;
  current_value: number | null;
}

export async function createWealthAlert(body: {
  alert_type: string;
  asset_id?: string;
  threshold_usd?: number;
  message: string;
}): Promise<WealthAlertItem> {
  const response = await fetch(`${API_BASE_URL}/alerts/wealth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Failed to create alert"));
  }
  return response.json() as Promise<WealthAlertItem>;
}

export async function getWealthAlerts(): Promise<WealthAlertItem[]> {
  const response = await fetch(`${API_BASE_URL}/alerts/wealth`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch wealth alerts: ${response.status}`);
  return response.json() as Promise<WealthAlertItem[]>;
}

export async function checkWealthAlerts(): Promise<TriggeredWealthAlert[]> {
  const response = await fetch(`${API_BASE_URL}/alerts/wealth/check`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to check wealth alerts: ${response.status}`);
  return response.json() as Promise<TriggeredWealthAlert[]>;
}

export async function deleteWealthAlert(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/alerts/wealth/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to delete wealth alert: ${response.status}`);
}

// --- Receivable PUT (full update) ---

export async function updateReceivable(id: string, body: {
  from_person: string; amount: string; currency: string; expected_date?: string; notes?: string;
}): Promise<ReceivableItem> {
  const response = await fetch(`${API_BASE_URL}/networth/receivables/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Failed to update receivable"));
  }
  return response.json() as Promise<ReceivableItem>;
}

// --- Net Worth Analyze ---

// --- App Notifications ---

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "alert";
  is_read: boolean;
  created_at: string;
}

export async function getNotifications(): Promise<AppNotification[]> {
  const response = await fetch(`${API_BASE_URL}/notifications`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch notifications: ${response.status}`);
  return response.json() as Promise<AppNotification[]>;
}

export async function getUnreadCount(): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/notifications/unread-count`, { headers: authHeaders() });
  if (!response.ok) return 0;
  const data = await response.json() as { count: number };
  return data.count;
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const response = await fetch(`${API_BASE_URL}/notifications/${id}/read`, {
    method: "PATCH",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to mark notification read: ${response.status}`);
  return response.json() as Promise<AppNotification>;
}

export async function markAllNotificationsRead(): Promise<void> {
  await fetch(`${API_BASE_URL}/notifications/mark-all-read`, {
    method: "POST",
    headers: authHeaders(),
  });
}

export async function generateDailyNotifications(lang = "en"): Promise<{ created: number; skipped: boolean }> {
  const response = await fetch(`${API_BASE_URL}/notifications/generate-daily?lang=${lang}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to generate notifications: ${response.status}`);
  return response.json() as Promise<{ created: number; skipped: boolean }>;
}

// --- Global Assistant ---

export type AssistantPageContext = "home" | "networth" | "transactions" | "cashflow";

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ActionProposal {
  action_id: string;
  action_type: string;
  description: string;
  params: Record<string, unknown>;
}

export interface AssistantChatResponse {
  reply: string;
  proposal: ActionProposal | null;
}

export async function assistantChat(
  message: string,
  pageContext: AssistantPageContext,
  sessionHistory: AssistantChatMessage[],
): Promise<AssistantChatResponse> {
  const response = await fetch(`${API_BASE_URL}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message, page_context: pageContext, session_history: sessionHistory }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Assistant unavailable"));
  }
  return response.json() as Promise<AssistantChatResponse>;
}

export async function confirmAssistantAction(actionId: string): Promise<{ ok: boolean; message: string | null; action_type: string | null }> {
  const response = await fetch(`${API_BASE_URL}/assistant/action/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action_id: actionId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(err, "Action failed"));
  }
  return response.json();
}

export async function rejectAssistantAction(actionId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/assistant/action/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action_id: actionId }),
  });
}

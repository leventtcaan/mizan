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
  onboarding_completed: boolean;
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
  message: string;
  suggestions?: SuggestionItem[];
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

export interface CreateTransactionRequest {
  amount: string;
  transaction_type: "debit" | "credit";
  description: string;
  transaction_date: string;
  category?: string;
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

export interface SubscriptionItem {
  merchant_key: string;
  merchant: string;
  avg_amount: string;
  frequency: "monthly" | "weekly";
  last_seen: string;
  total_paid_all_time: string;
  months_active: number;
  category: string;
  flag: "essential" | "review" | "cancelled" | null;
}

export interface SubscriptionsResponse {
  subscriptions: SubscriptionItem[];
}

export interface SubscriptionSummary {
  total_monthly_cost: string;
  count: number;
  flagged_for_review: string[];
  potential_savings: string;
}

export async function getSubscriptions(): Promise<SubscriptionsResponse> {
  const response = await fetch(`${API_BASE_URL}/subscriptions`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch subscriptions: ${response.status}`);
  return response.json() as Promise<SubscriptionsResponse>;
}

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

export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
  const response = await fetch(`${API_BASE_URL}/subscriptions/summary`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch subscription summary: ${response.status}`);
  return response.json() as Promise<SubscriptionSummary>;
}

// --- Installments ---

export interface InstallmentPlan {
  merchant_key: string;
  merchant: string;
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

export interface InstallmentResponse {
  plans: InstallmentPlan[];
  insight: string | null;
  cached: boolean;
}

export interface InstallmentSummary {
  total_monthly_burden: number;
  active_plan_count: number;
  months_until_debt_free: number;
  total_remaining_nominal: number;
  total_opportunity_loss: number;
  income_pct: number | null;
}

export async function getInstallments(): Promise<InstallmentResponse> {
  const response = await fetch(`${API_BASE_URL}/installments`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch installments: ${response.status}`);
  return response.json() as Promise<InstallmentResponse>;
}

export async function getInstallmentSummary(): Promise<InstallmentSummary> {
  const response = await fetch(`${API_BASE_URL}/installments/summary`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch installment summary: ${response.status}`);
  return response.json() as Promise<InstallmentSummary>;
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
  created_at: string;
  updated_at: string;
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

export async function getAssets(): Promise<AssetItem[]> {
  const response = await fetch(`${API_BASE_URL}/networth/assets`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Failed to fetch assets: ${response.status}`);
  return response.json() as Promise<AssetItem[]>;
}

export async function createAsset(body: {
  name: string; asset_type: string; currency: string; current_value: string;
  notes?: string; source?: string; source_detail?: string; as_of_date?: string;
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
  name: string; asset_type: string; currency: string; current_value: string; notes?: string;
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

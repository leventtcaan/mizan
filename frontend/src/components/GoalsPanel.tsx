"use client";

import { useEffect, useState } from "react";
import { getGoalStatus, upsertGoal, deleteGoal, getGoals, type GoalStatusItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
] as const;

function formatAmount(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function statusColor(s: string): { bar: string; text: string; bg: string } {
  if (s === "exceeded") return { bar: "bg-red-500", text: "text-neg", bg: "bg-red-950/20" };
  if (s === "warning")  return { bar: "bg-amber-400", text: "text-amber-400", bg: "bg-amber-950/20" };
  return { bar: "bg-emerald-500", text: "text-emerald-400", bg: "" };
}

export default function GoalsPanel() {
  const { t } = useLanguage();
  const [items, setItems] = useState<GoalStatusItem[]>([]);
  const [goalCategories, setGoalCategories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formCategory, setFormCategory] = useState<string>(CATEGORIES[0]);
  const [formLimit, setFormLimit] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [statusData, goalsData] = await Promise.all([getGoalStatus(), getGoals()]);
      setItems(statusData);
      setGoalCategories(new Set(goalsData.map((g) => g.category)));
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSaving(true);
    try {
      await upsertGoal(formCategory, formLimit);
      setShowForm(false);
      setFormLimit("");
      setLoading(true);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (category: string) => {
    try {
      await deleteGoal(category);
      setItems((prev) => prev.filter((i) => i.category !== category));
      setGoalCategories((prev) => { const s = new Set(prev); s.delete(category); return s; });
    } catch {}
  };

  const availableCategories = CATEGORIES.filter((c) => !goalCategories.has(c));

  return (
    <div className="mb-6 bg-surface border border-line rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider">{t("goals.title")}</p>
        {availableCategories.length > 0 && (
          <button
            onClick={() => { setShowForm((v) => !v); setFormCategory(availableCategories[0]); setFormError(null); }}
            className="px-3 py-1 rounded-lg bg-brand hover:bg-brand-hover text-xs font-medium text-white transition-colors"
          >
            {showForm ? t("common.cancel") : t("goals.addGoal")}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleAddGoal} className="mb-4 p-4 rounded-lg bg-canvas border border-line space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-ink-mute mb-1">{t("goals.category")}</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
              >
                {availableCategories.map((c) => {
                  const key = `category.${c}`;
                  const label = t(key) !== key ? t(key) : c;
                  return <option key={c} value={c}>{label}</option>;
                })}
              </select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs text-ink-mute mb-1">{t("goals.monthlyLimit")}</label>
              <input
                type="number"
                min="1"
                step="1"
                value={formLimit}
                onChange={(e) => setFormLimit(e.target.value)}
                required
                placeholder="1500"
                className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-ink text-sm placeholder-gray-700 focus:outline-none focus:border-brand"
              />
            </div>
          </div>
          {formError && <p className="text-neg text-xs">{formError}</p>}
          <button
            type="submit"
            disabled={formSaving}
            className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-sm font-medium text-white transition-colors"
          >
            {formSaving ? t("common.loading") : t("goals.save")}
          </button>
        </form>
      )}

      {loading && <p className="text-ink-mute text-sm animate-pulse py-4 text-center">{t("common.loading")}</p>}
      {!loading && error && <p className="text-neg text-sm py-4 text-center">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-ink-mute text-sm py-4 text-center">{t("goals.noGoals")}</p>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => {
            const { bar, text, bg } = statusColor(item.status);
            const pct = Math.min(item.pct_used, 100);
            const catKey = `category.${item.category}`;
            const catLabel = t(catKey) !== catKey ? t(catKey) : item.category;
            const statusKey = `goals.status.${item.status}` as const;
            const statusText = t(statusKey) !== statusKey ? t(statusKey) : item.status;
            return (
              <div key={item.category} className={`rounded-lg p-3.5 border border-line ${bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-soft">{catLabel}</span>
                    <span className={`text-xs font-semibold ${text}`}>{statusText}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-ink-mute font-mono">
                      {formatAmount(item.spent_this_month)}
                      <span className="text-ink-mute"> / {formatAmount(item.monthly_limit)}</span>
                    </span>
                    <button
                      onClick={() => void handleDelete(item.category)}
                      className="text-gray-700 hover:text-neg text-sm leading-none transition-colors"
                      title={t("common.delete")}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className={`text-xs ${text}`}>{item.pct_used}%</span>
                  {parseFloat(item.remaining) >= 0 ? (
                    <span className="text-xs text-ink-mute">{formatAmount(item.remaining)} {t("goals.remaining")}</span>
                  ) : (
                    <span className="text-xs text-neg">{formatAmount(Math.abs(parseFloat(item.remaining)))} {t("goals.exceeded")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

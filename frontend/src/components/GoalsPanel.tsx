"use client";

import { useEffect, useState } from "react";
import { getGoalStatus, upsertGoal, deleteGoal, getGoals, type GoalStatusItem } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
] as const;

function formatTL(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " ₺";
}

function statusColor(s: string): { bar: string; text: string; bg: string } {
  if (s === "exceeded") return { bar: "bg-red-500", text: "text-red-400", bg: "bg-red-950/40" };
  if (s === "warning")  return { bar: "bg-yellow-400", text: "text-yellow-400", bg: "bg-yellow-950/30" };
  return { bar: "bg-emerald-500", text: "text-emerald-400", bg: "" };
}

function statusLabel(s: string): string {
  if (s === "exceeded") return "Aşıldı";
  if (s === "warning")  return "Yaklaşıyor";
  return "İyi";
}

export default function GoalsPanel() {
  const [items, setItems] = useState<GoalStatusItem[]>([]);
  const [goalCategories, setGoalCategories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New goal form state
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
      setError("Hedefler yüklenemedi.");
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
      setFormError(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (category: string) => {
    try {
      await deleteGoal(category);
      setItems((prev) => prev.filter((i) => i.category !== category));
      setGoalCategories((prev) => { const s = new Set(prev); s.delete(category); return s; });
    } catch {
      // Silent — user can retry
    }
  };

  // Categories not yet tracked by a goal
  const availableCategories = CATEGORIES.filter((c) => !goalCategories.has(c));

  return (
    <div className="mb-8 p-5 rounded-xl bg-gray-900 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
          Bütçe Hedefleri
        </p>
        {availableCategories.length > 0 && (
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setFormCategory(availableCategories[0]);
              setFormError(null);
            }}
            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
          >
            {showForm ? "İptal" : "+ Hedef Ekle"}
          </button>
        )}
      </div>

      {/* Add goal inline form */}
      {showForm && (
        <form onSubmit={handleAddGoal} className="mb-4 p-4 rounded-lg bg-gray-800 border border-gray-700 space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-gray-500 mb-1">Kategori</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
              >
                {availableCategories.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs text-gray-500 mb-1">Aylık Limit (₺)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={formLimit}
                onChange={(e) => setFormLimit(e.target.value)}
                required
                placeholder="1500"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          {formError && <p className="text-red-400 text-xs">{formError}</p>}
          <button
            type="submit"
            disabled={formSaving}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
          >
            {formSaving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </form>
      )}

      {loading && (
        <p className="text-gray-500 text-sm animate-pulse py-4 text-center">Yükleniyor...</p>
      )}
      {!loading && error && (
        <p className="text-red-400 text-sm py-4 text-center">{error}</p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="text-gray-600 text-sm py-4 text-center">
          Henüz hedef yok. &quot;+ Hedef Ekle&quot; ile başlayın.
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => {
            const { bar, text, bg } = statusColor(item.status);
            const pct = Math.min(item.pct_used, 100);
            return (
              <div
                key={item.category}
                className={`rounded-lg p-3 border border-gray-800 ${bg}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </span>
                    <span className={`text-xs font-semibold ${text}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-mono">
                      {formatTL(item.spent_this_month)}
                      <span className="text-gray-600"> / {formatTL(item.monthly_limit)}</span>
                    </span>
                    <button
                      onClick={() => void handleDelete(item.category)}
                      className="text-gray-700 hover:text-red-500 text-xs transition-colors"
                      title="Hedefi sil"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${bar}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className={`text-xs ${text}`}>{item.pct_used}%</span>
                  {parseFloat(item.remaining) >= 0 ? (
                    <span className="text-xs text-gray-600">
                      {formatTL(item.remaining)} kaldı
                    </span>
                  ) : (
                    <span className="text-xs text-red-500">
                      {formatTL(Math.abs(parseFloat(item.remaining)))} aşıldı
                    </span>
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

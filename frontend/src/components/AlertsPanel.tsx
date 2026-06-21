"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAlerts, dismissAlert, Alert } from "@/lib/api";

const TYPE_ACCENT: Record<string, string> = {
  forgotten_subscription: "border-l-purple-500",
  recurring: "border-l-blue-500",
  post_salary_spike: "border-l-amber-500",
};

const TYPE_LABEL: Record<string, string> = {
  forgotten_subscription: "Unutulan Abonelik",
  recurring: "Düzenli Ödeme",
  post_salary_spike: "Maaş Sonrası Harcama",
};

const TYPE_ICON: Record<string, string> = {
  forgotten_subscription: "💳",
  recurring: "🔄",
  post_salary_spike: "📈",
};

export default function AlertsPanel() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getAlerts();
      setAlerts(data);
    } catch {
      // silent — panel stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  const handleDismiss = async (dismissKey: string) => {
    setDismissing((prev) => new Set(prev).add(dismissKey));
    try {
      await dismissAlert(dismissKey);
      setAlerts((prev) => prev.filter((a) => a.dismiss_key !== dismissKey));
    } catch {
      // silent
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(dismissKey);
        return next;
      });
    }
  };

  const handleAskCoach = (message: string) => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("chat_prefill", message);
    }
    router.push("/transactions");
  };

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse mb-6">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-[#1A1A1A] rounded-xl" />
        ))}
      </div>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Dikkat Çeken Örüntüler
      </p>
      <div className="space-y-2">
        {alerts.map((alert) => {
          const accent = TYPE_ACCENT[alert.type] ?? "border-l-gray-600";
          return (
            <div
              key={alert.dismiss_key}
              className={`bg-[#1A1A1A] border border-[#2A2A2A] border-l-2 ${accent} rounded-xl p-4 flex items-start gap-3`}
            >
              <span className="text-base mt-0.5 shrink-0">{TYPE_ICON[alert.type] ?? "⚠"}</span>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-500 mb-0.5">
                  {TYPE_LABEL[alert.type] ?? alert.type}
                </p>
                <p className="text-sm text-gray-200 leading-snug">{alert.message}</p>
              </div>

              <div className="flex flex-col gap-1.5 shrink-0 items-end">
                {alert.actionable && (
                  <button
                    onClick={() => handleAskCoach(alert.message)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 whitespace-nowrap transition-colors"
                  >
                    Sohbete sor →
                  </button>
                )}
                <button
                  onClick={() => void handleDismiss(alert.dismiss_key)}
                  disabled={dismissing.has(alert.dismiss_key)}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-50"
                >
                  {dismissing.has(alert.dismiss_key) ? "..." : "Kapat"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getInflationAnalysis, type CategoryInflation } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function verdictStyle(item: CategoryInflation): { color: string; bg: string; icon: string } {
  const r = item.real_pct;
  if (r > 20)  return { color: "text-red-400",     bg: "bg-red-950/60 border-red-900",        icon: "↑↑" };
  if (r > 0)   return { color: "text-orange-400",  bg: "bg-orange-950/60 border-orange-900",   icon: "↑"  };
  if (r < -5)  return { color: "text-emerald-400", bg: "bg-emerald-950/60 border-emerald-900", icon: "↓"  };
  return              { color: "text-gray-400",    bg: "bg-[#2A2A2A] border-[#3A3A3A]",        icon: "→"  };
}

export default function InflationPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<CategoryInflation[] | null>(null);
  const [cached, setCached] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error" | "empty">("loading");

  useEffect(() => {
    getInflationAnalysis()
      .then((res) => {
        if (res.analyses.length === 0) {
          setState("empty");
        } else {
          setData(res.analyses);
          setCached(res.cached);
          setState("ready");
        }
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "error" || state === "empty") return null;

  return (
    <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {t("progress.inflation")}
        </p>
        {cached && <span className="text-gray-600 text-xs">{t("progress.cached")}</span>}
      </div>

      {state === "loading" && (
        <p className="text-gray-600 text-sm animate-pulse py-4 text-center">{t("common.loading")}</p>
      )}

      {state === "ready" && data && (
        <>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {[t("common.type"), "—", "—", "%", "%", "—"].map((h, i) => (
                    <th key={i} className={`text-xs font-medium text-gray-500 pb-3 ${i === 0 ? "text-left pr-4" : "text-right px-3"}`}>{i === 0 ? t("common.type") : h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((item, i) => {
                  const v = verdictStyle(item);
                  const nomSign = item.nominal_pct > 0 ? "+" : "";
                  const realSign = item.real_pct > 0 ? "+" : "";
                  const catKey = `category.${item.category}`;
                  const catLabel = t(catKey) !== catKey ? t(catKey) : item.category;
                  return (
                    <tr key={item.category} className={`border-b border-[#2A2A2A] last:border-0 ${i % 2 !== 0 ? "bg-[#0F0F0F]/40" : ""}`}>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-gray-200">{catLabel}</div>
                        <div className="text-gray-600 text-xs mt-0.5">{monthLabel(item.old_month)} → {monthLabel(item.new_month)}</div>
                      </td>
                      <td className="py-3 px-3 text-right text-gray-500 font-mono text-xs">{formatAmount(item.old_avg)}</td>
                      <td className="py-3 px-3 text-right text-gray-200 font-mono text-xs">{formatAmount(item.new_avg)}</td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-gray-400">{nomSign}{item.nominal_pct.toFixed(1)}%</td>
                      <td className={`py-3 px-3 text-right font-mono text-xs font-bold ${v.color}`}>{realSign}{item.real_pct.toFixed(1)}%</td>
                      <td className="py-3 pl-3 text-right">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${v.color} ${v.bg}`}>
                          {v.icon}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

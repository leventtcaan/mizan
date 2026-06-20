"use client";

import { useEffect, useState } from "react";
import { getInflationAnalysis, type CategoryInflation } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("tr-TR", {
    month: "short",
    year: "numeric",
  });
}

function formatTL(n: number): string {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n) + " ₺";
}

function verdictStyle(item: CategoryInflation): {
  label: string;
  color: string;
  bg: string;
  icon: string;
} {
  const r = item.real_pct;
  if (r > 20)  return { label: "Enflasyonun çok üzerinde", color: "text-red-400",    bg: "bg-red-950",    icon: "↑↑" };
  if (r > 0)   return { label: "Enflasyonun üzerinde",     color: "text-orange-400", bg: "bg-orange-950", icon: "↑"  };
  if (r < -5)  return { label: "Enflasyonun altında",      color: "text-emerald-400",bg: "bg-emerald-950",icon: "↓"  };
  return              { label: "Enflasyonla paralel",       color: "text-gray-400",   bg: "bg-gray-800",   icon: "→"  };
}

export default function InflationPanel() {
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
    <div className="mb-6 p-5 rounded-xl bg-gray-900 border border-gray-800">
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
          Enflasyona Göre Harcama Analizi
        </p>
        {cached && (
          <span className="text-gray-600 text-xs">önbellekten</span>
        )}
      </div>
      <p className="text-xs text-gray-600 mb-5">
        TÜFE'ye göre gerçek harcama değişiminiz — en eski ay ile en yeni ay karşılaştırılıyor
      </p>

      {state === "loading" && (
        <p className="text-gray-500 text-sm animate-pulse py-4 text-center">Hesaplanıyor...</p>
      )}

      {state === "ready" && data && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-800 text-gray-400 uppercase text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-2.5">Kategori</th>
                  <th className="px-4 py-2.5 text-right">Eski Ort.</th>
                  <th className="px-4 py-2.5 text-right">Yeni Ort.</th>
                  <th className="px-4 py-2.5 text-right">Nominal</th>
                  <th className="px-4 py-2.5 text-right">Gerçek</th>
                  <th className="px-4 py-2.5 text-right">Yorum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.map((item) => {
                  const v = verdictStyle(item);
                  const nomSign = item.nominal_pct > 0 ? "+" : "";
                  const realSign = item.real_pct > 0 ? "+" : "";
                  return (
                    <tr key={item.category} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-200">
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </div>
                        <div className="text-gray-600 text-xs mt-0.5">
                          {monthLabel(item.old_month)} → {monthLabel(item.new_month)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                        {formatTL(item.old_avg)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-200 font-mono text-xs">
                        {formatTL(item.new_avg)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-400">
                        {nomSign}{item.nominal_pct.toFixed(1)}%
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${v.color}`}>
                        {realSign}{item.real_pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${v.color} ${v.bg}`}>
                          {v.icon} {v.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Inflation context row */}
          {data[0] && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block" />
              <span>
                Kümülatif TÜFE ({monthLabel(data[data.length - 1]?.old_month ?? "")} – günümüz):{" "}
                <span className="text-gray-400">
                  ~%{Math.max(...data.map((d) => d.inflation_pct)).toFixed(0)}
                </span>
              </span>
            </div>
          )}

          <p className="mt-3 text-xs text-gray-700">
            ⚠ TÜFE verileri yaklaşık değerlerdir (TÜİK 2023-2026). Gerçek oranlar farklılık gösterebilir.
          </p>
        </>
      )}
    </div>
  );
}

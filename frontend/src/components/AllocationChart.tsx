"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, Sector, ResponsiveContainer } from "recharts";

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
}
export interface CurrencyExposure {
  code: string;
  value: number;
}

// Refined, finance-app palette (Monarch/Copilot style — saturated but not garish).
const PALETTE = ["#6366F1", "#10B981", "#F59E0B", "#F43F5E", "#0EA5E9", "#8B5CF6", "#14B8A6", "#94A3B8"];

function fmt(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)} ${currency}`;
  }
}

// Active slice renders slightly larger with a soft outer ring — the "premium" hover feel.
function renderActiveShape(props: unknown) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props as {
    cx: number; cy: number; innerRadius: number; outerRadius: number; startAngle: number; endAngle: number; fill: string;
  };
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 8} outerRadius={outerRadius + 10} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.35} />
    </g>
  );
}

export default function AllocationChart({
  slices,
  currencyBars,
  displayCurrency,
  t,
}: {
  slices: AllocationSlice[];
  currencyBars: CurrencyExposure[];
  displayCurrency: string;
  t: (k: string) => string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0 || slices.length === 0) return null;

  const shown = active !== null && slices[active] ? slices[active] : null;
  const ccyTotal = currencyBars.reduce((s, x) => s + x.value, 0);

  return (
    <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{t("nw.allocation.title")}</h3>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: 180, height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={58}
                outerRadius={80}
                paddingAngle={2}
                stroke="none"
                activeIndex={active ?? undefined}
                activeShape={renderActiveShape}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                {slices.map((s, i) => (
                  <Cell key={s.key} fill={PALETTE[i % PALETTE.length]} className="cursor-pointer outline-none" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {shown ? (
              <>
                <span className="text-[11px] text-gray-500 max-w-[100px] truncate text-center">{shown.label}</span>
                <span className="text-sm font-bold text-white tabular-nums">{Math.round((shown.value / total) * 100)}%</span>
                <span className="text-[10px] text-gray-500 tabular-nums">{fmt(shown.value, displayCurrency)}</span>
              </>
            ) : (
              <>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">{t("nw.allocation.total")}</span>
                <span className="text-base font-bold text-white tabular-nums">{fmt(total, displayCurrency)}</span>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 w-full space-y-1.5">
          {slices.map((s, i) => {
            const pct = Math.round((s.value / total) * 100);
            const isActive = active === i;
            return (
              <button
                key={s.key}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors text-left ${
                  isActive ? "bg-[#222]" : "hover:bg-[#1E1E1E]"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                <span className="text-sm text-gray-300 flex-1 truncate">{s.label}</span>
                <span className="text-xs text-gray-500 tabular-nums">{pct}%</span>
                <span className="text-sm text-gray-200 font-medium tabular-nums w-24 text-right">{fmt(s.value, displayCurrency)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-currency exposure bars */}
      {currencyBars.length > 1 && ccyTotal > 0 && (
        <div className="mt-5 pt-4 border-t border-[#2A2A2A]">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-3">{t("nw.allocation.currencyExposure")}</p>
          {/* Stacked bar */}
          <div className="flex h-2.5 rounded-full overflow-hidden mb-3">
            {currencyBars.map((c, i) => (
              <div
                key={c.code}
                style={{ width: `${(c.value / ccyTotal) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                title={`${c.code} ${Math.round((c.value / ccyTotal) * 100)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {currencyBars.map((c, i) => (
              <div key={c.code} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                <span className="text-xs text-gray-400">{c.code}</span>
                <span className="text-xs text-gray-600 tabular-nums">{Math.round((c.value / ccyTotal) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

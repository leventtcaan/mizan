"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrencyList, type CurrencyEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import {
  AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates,
} from "./shared";

const TOP_N = 10;

export default function CryptoAssetForm({ onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();
  const [coins, setCoins] = useState<CurrencyEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CurrencyEntry | null>(null);
  const [qty, setQty] = useState("");

  useEffect(() => {
    // CoinGecko returns coins sorted by market_cap_desc — first N are the top by market cap
    getCurrencyList().then((l) => setCoins(l.crypto)).catch(() => setCoins([]));
  }, []);

  const topCoins = useMemo(() => coins.slice(0, TOP_N), [coins]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return coins
      .filter((e) => e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [coins, query]);

  useEffect(() => {
    const n = parseFloat(qty);
    if (selected && !isNaN(n) && n > 0) {
      onDraftChange({
        name: selected.name,
        asset_type: "crypto",
        currency: selected.code,
        current_value: qty,
        source_detail: buildSourceDetail({ subtype: "crypto", symbol: selected.code, name: selected.name }),
      });
    } else {
      onDraftChange(null);
    }
  }, [selected, qty]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitUsd = selected ? usdPriceOf(selected.code) : null;
  const preview = selected && qty ? previewLine((unitUsd ?? 0) * parseFloat(qty || "0"), displayCurrency, rates) : null;

  function pick(entry: CurrencyEntry) {
    setSelected(entry);
    setQuery("");
  }

  function fmtUsdPrice(usd: number): string {
    if (usd >= 1000) return `$${Math.round(usd).toLocaleString()}`;
    if (usd >= 1)    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }

  return (
    <div className="space-y-4">
      {/* Top 10 by market cap */}
      {topCoins.length > 0 && (
        <div>
          <p className="text-[11px] text-ink-mute mb-2">{t("assetForm.popular")}</p>
          <div className="grid grid-cols-5 gap-1.5">
            {topCoins.map((e) => {
              const price = usdPriceOf(e.code);
              return (
                <button key={e.code} type="button" onClick={() => pick(e)}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-lg text-xs border transition-colors ${
                    selected?.code === e.code
                      ? "bg-brand/20 border-brand/50 text-brand"
                      : "bg-canvas border-line text-ink-soft hover:border-brand"
                  }`}>
                  <span className="font-bold">{e.code}</span>
                  {price !== null && (
                    <span className={`text-[9px] tabular-nums ${selected?.code === e.code ? "text-brand" : "text-ink-mute"}`}>
                      {fmtUsdPrice(price)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search for any coin */}
      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.cryptoSearchLabel")}</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("assetForm.cryptoSearchHint")}
          className={sharedInputClass}
        />
        {matches.length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-line">
            {matches.map((e) => (
              <button key={`${e.code}-${e.name}`} type="button" onClick={() => pick(e)}
                className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-ink-soft hover:bg-[#13110D]">
                <span className="font-semibold">{e.code}</span>
                <span className="text-ink-mute truncate ml-3">{e.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected coin summary */}
      {selected && (
        <div className="rounded-lg bg-brand/20 border border-brand/30 px-3 py-2 flex items-center justify-between">
          <span className="text-sm text-brand font-medium">{selected.code} · {selected.name}</span>
          {unitUsd !== null && <span className="text-xs text-ink-mute">{fmtUsdPrice(unitUsd)}</span>}
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.holdings")}</label>
        <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
          placeholder={t("assetForm.holdingsHint")} className={sharedInputClass} />
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>
    </div>
  );
}

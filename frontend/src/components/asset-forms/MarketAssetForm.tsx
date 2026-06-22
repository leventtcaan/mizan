"use client";

import { useEffect, useState } from "react";
import { getMarketQuote } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates } from "./shared";

/** Handles stock and fund. Live USD quote via Yahoo, graceful manual fallback. */
export default function MarketAssetForm({ assetType, onDraftChange }: AssetFormProps) {
  const { t } = useLanguage();
  const { tryPerUsd } = useUsdRates();
  const isFund = assetType === "fund";

  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const [shares, setShares] = useState("");
  const [manualValue, setManualValue] = useState("");

  const quoteFailed = tried && quote === null;

  async function lookup() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || quoting) return;
    setQuoting(true);
    setTried(true);
    try {
      const res = await getMarketQuote(sym);
      setQuote(res.price_usd);
    } catch {
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    const sd = buildSourceDetail({
      subtype: assetType, symbol: sym, code: sym, name: name.trim(), venue: venue.trim(),
      ...(quote !== null ? { last_price_usd: quote, quantity: shares } : {}),
    });
    if (quote !== null && parseFloat(shares) > 0) {
      const total = quote * parseFloat(shares);
      onDraftChange({ name: name.trim() || sym, asset_type: assetType, currency: "USD", current_value: total.toFixed(2), source_detail: sd });
    } else if (quoteFailed && parseFloat(manualValue) > 0 && sym) {
      onDraftChange({ name: name.trim() || sym, asset_type: assetType, currency: "USD", current_value: manualValue, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [symbol, name, venue, quote, shares, manualValue, quoteFailed, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = quote !== null && shares ? quote * parseFloat(shares || "0") : null;
  const preview = total !== null ? previewLine(total, tryPerUsd) : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{isFund ? t("assetForm.fundCodeLabel") : t("assetForm.tickerLabel")}</label>
        <div className="flex gap-2">
          <input value={symbol}
            onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setQuote(null); setTried(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }}
            placeholder={isFund ? t("assetForm.fundCodeHint") : t("assetForm.tickerHint")}
            className={sharedInputClass + " uppercase"} />
          <button type="button" onClick={lookup} disabled={!symbol.trim() || quoting}
            className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-600/30 disabled:opacity-40 text-xs font-medium transition-colors">
            {quoting ? t("assetForm.fetching") : t("assetForm.lookup")}
          </button>
        </div>
      </div>

      {quote !== null && (
        <>
          <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-gray-400">{t("assetForm.livePrice")}</span>
            <span className="text-sm text-emerald-300 font-semibold tabular-nums">
              ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(quote)}
            </span>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.shares")}</label>
            <input type="number" min="0" step="any" value={shares} onChange={(e) => setShares(e.target.value)}
              placeholder={t("assetForm.sharesHint")} className={sharedInputClass} />
            {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
          </div>
        </>
      )}

      {quoteFailed && (
        <div>
          <p className="text-amber-400/80 text-xs mb-2">{t("assetForm.marketManualNote")}</p>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.totalValueUsd")}</label>
          <input type="number" min="0" step="0.01" value={manualValue} onChange={(e) => setManualValue(e.target.value)}
            placeholder="0.00" className={sharedInputClass} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={t("assetForm.nameOptional")} className={sharedInputClass} />
        <input value={venue} onChange={(e) => setVenue(e.target.value)}
          placeholder={t("assetForm.venueOptional")} className={sharedInputClass} />
      </div>
    </div>
  );
}

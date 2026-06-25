"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrencyList, type CurrencyEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates } from "./shared";

/** Handles foreign_currency and commodity — both are "quantity of a unit" assets. */
export default function CurrencyAssetForm({ assetType, onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();
  const isCommodity = assetType === "commodity";
  const [entries, setEntries] = useState<CurrencyEntry[]>([]);
  const [query, setQuery]     = useState("");
  const [selected, setSelected] = useState<CurrencyEntry | null>(null);
  const [qty, setQty] = useState("");

  useEffect(() => {
    getCurrencyList()
      .then((l) => setEntries(isCommodity ? l.commodities : l.fiat))
      .catch(() => setEntries([]));
  }, [isCommodity]);

  const matches = useMemo(() => {
    if (isCommodity) return entries; // show all as chips — list is small (~5 items)
    const q = query.trim().toLowerCase();
    const base = q
      ? entries.filter((e) => e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      : entries;
    return base.slice(0, 8);
  }, [entries, query, isCommodity]);

  useEffect(() => {
    const n = parseFloat(qty);
    if (selected && !isNaN(n) && n > 0) {
      onDraftChange({
        name: selected.name,
        asset_type: assetType,
        currency: selected.code,
        current_value: qty,
        source_detail: buildSourceDetail({
          subtype: isCommodity ? "commodity" : "foreign_currency",
          code: selected.code,
          name: selected.name,
        }),
      });
    } else {
      onDraftChange(null);
    }
  }, [selected, qty, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitUsd = selected ? usdPriceOf(selected.code) : null;
  const totalUsd = unitUsd !== null && qty ? (unitUsd * parseFloat(qty || "0")) : null;
  const preview = previewLine(totalUsd, displayCurrency, rates);

  function fmtUsdPrice(usd: number): string {
    if (usd >= 1000) return `$${Math.round(usd).toLocaleString()}`;
    if (usd >= 1) return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }

  // ── Commodity: chip grid with live prices ────────────────────────────────
  if (isCommodity) {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-ink-mute mb-2">{t("assetForm.commodityChooseLabel")}</label>
          <div className="grid grid-cols-3 gap-2">
            {matches.map((e) => {
              const price = usdPriceOf(e.code);
              return (
                <button key={e.code} type="button" onClick={() => { setSelected(e); setQty(""); }}
                  className={`flex flex-col items-center gap-0.5 px-2 py-3 rounded-lg text-xs border transition-colors ${
                    selected?.code === e.code
                      ? "bg-[#176B5B]/10 border-[#176B5B]/30 text-[#176B5B]"
                      : "bg-canvas border-line text-ink-soft hover:border-[#176B5B]"
                  }`}>
                  <span className="font-bold text-sm">{e.code}</span>
                  <span className="text-ink-mute text-[10px] truncate w-full text-center">{e.name}</span>
                  {price !== null && (
                    <span className={`text-[10px] tabular-nums mt-0.5 ${selected?.code === e.code ? "text-[#176B5B]" : "text-ink-mute"}`}>
                      {fmtUsdPrice(price)}
                    </span>
                  )}
                </button>
              );
            })}
            {matches.length === 0 && (
              <p className="col-span-3 text-xs text-ink-mute py-2">{t("common.notFound")}</p>
            )}
          </div>
        </div>

        {selected && (
          <div>
            <label className="block text-xs text-ink-mute mb-1.5">
              {t("assetForm.amountHeld")}
              {unitUsd !== null && (
                <span className="ml-2 text-ink-mute tabular-nums">
                  · 1 {selected.code} = {fmtUsdPrice(unitUsd)}
                </span>
              )}
            </label>
            <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
              placeholder={t("assetForm.amountHeldHint")} className={sharedInputClass} />
            {preview && <p className="text-pos text-xs mt-1.5">{preview}</p>}
          </div>
        )}
      </div>
    );
  }

  // ── Foreign currency: searchable list ────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.currencyChooseLabel")}</label>
        {selected && (
          <div className="flex items-center justify-between mb-2 px-3 py-2 rounded-lg bg-[#176B5B]/10 border border-[#176B5B]/30">
            <span className="text-sm font-semibold text-[#176B5B]">{selected.code}</span>
            <span className="text-xs text-ink-mute truncate ml-3">{selected.name}</span>
            <button type="button" onClick={() => { setSelected(null); setQuery(""); }}
              className="ml-3 text-ink-mute hover:text-ink-soft text-xs">✕</button>
          </div>
        )}
        {!selected && (
          <>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t("assetForm.currencySearchHint")} className={sharedInputClass} />
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-line">
              {matches.map((e) => (
                <button key={e.code} type="button" onClick={() => { setSelected(e); setQuery(""); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#13110D] text-ink-soft">
                  <span className="font-semibold">{e.code}</span>
                  <span className="text-ink-mute truncate ml-3">{e.name}</span>
                </button>
              ))}
              {matches.length === 0 && <p className="px-3 py-3 text-xs text-ink-mute">{t("common.notFound")}</p>}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div>
          <label className="block text-xs text-ink-mute mb-1.5">
            {t("assetForm.amountHeld")}
            {unitUsd !== null && (
              <span className="ml-2 text-ink-mute tabular-nums">
                · 1 {selected.code} = {fmtUsdPrice(unitUsd)}
              </span>
            )}
          </label>
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
            placeholder={t("assetForm.amountHeldHint")} className={sharedInputClass} />
          {preview && (
            <p className="text-pos text-xs mt-1.5">
              {preview} <span className="text-ink-mute">({displayCurrency})</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

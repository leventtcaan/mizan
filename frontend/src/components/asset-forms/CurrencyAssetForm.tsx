"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrencyList, type CurrencyEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates } from "./shared";

/** Handles foreign_currency and commodity — both are "quantity of a unit" assets. */
export default function CurrencyAssetForm({ assetType, onDraftChange }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, tryPerUsd } = useUsdRates();
  const isCommodity = assetType === "commodity";
  const [entries, setEntries] = useState<CurrencyEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CurrencyEntry | null>(null);
  const [qty, setQty] = useState("");

  useEffect(() => {
    getCurrencyList()
      .then((l) => setEntries(isCommodity ? l.commodities : l.fiat))
      .catch(() => setEntries([]));
  }, [isCommodity]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? entries.filter((e) => e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      : entries;
    return base.slice(0, isCommodity ? 12 : 8);
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
  const preview = selected && qty ? previewLine((unitUsd ?? 0) * parseFloat(qty || "0"), tryPerUsd) : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {isCommodity ? t("assetForm.commodityChooseLabel") : t("assetForm.currencyChooseLabel")}
        </label>
        <input value={query} onChange={(e) => { setQuery(e.target.value); }}
          placeholder={isCommodity ? t("assetForm.commoditySearchHint") : t("assetForm.currencySearchHint")}
          className={sharedInputClass} />
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[#2A2A2A]">
          {matches.map((e) => (
            <button key={e.code} type="button" onClick={() => { setSelected(e); setQuery(""); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#111] ${
                selected?.code === e.code ? "bg-indigo-950/40 text-indigo-300" : "text-gray-300"
              }`}>
              <span className="font-semibold">{e.code}</span>
              <span className="text-gray-500 truncate ml-3">{e.name}</span>
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-3 text-xs text-gray-600">{t("common.notFound")}</p>}
        </div>
      </div>

      {selected && (
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.amountHeld")}</label>
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
            placeholder={t("assetForm.amountHeldHint")} className={sharedInputClass} />
          {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
        </div>
      )}
    </div>
  );
}

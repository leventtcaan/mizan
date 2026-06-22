"use client";

import { useEffect, useState } from "react";
import { getTefasFund } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates } from "./shared";

export default function FundAssetForm({ onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();

  const [code, setCode] = useState("");
  const [fundName, setFundName] = useState("");
  const [nav, setNav] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);
  const [tried, setTried] = useState(false);
  const [units, setUnits] = useState("");
  const [manualValue, setManualValue] = useState("");

  const lookupFailed = tried && nav === null;
  const hasNav = nav !== null;

  function resetNav() {
    setNav(null);
    setFundName("");
    setTried(false);
  }

  async function lookup() {
    const c = code.trim().toUpperCase();
    if (!c || fetching) return;
    setFetching(true);
    setTried(true);
    try {
      const res = await getTefasFund(c);
      setNav(res.nav);
      if (res.name) setFundName(res.name);
    } catch {
      setNav(null);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    const c = code.trim().toUpperCase();
    const unitsN = parseFloat(units);

    if (hasNav && nav !== null && unitsN > 0) {
      const totalTRY = nav * unitsN;
      const tryUsd = usdPriceOf("TRY");
      const totalUsd = tryUsd !== null ? totalTRY * tryUsd : null;
      const sd = buildSourceDetail({ subtype: "fund", code: c, name: fundName, nav, units, currency: "TRY" });
      onDraftChange({
        name: fundName || c,
        asset_type: "fund",
        currency: "TRY",
        current_value: totalTRY.toFixed(2),
        source_detail: sd,
      });
      void totalUsd; // preview computed inline below
    } else if (lookupFailed && parseFloat(manualValue) > 0 && c) {
      const sd = buildSourceDetail({ subtype: "fund", code: c, name: fundName });
      onDraftChange({ name: fundName || c, asset_type: "fund", currency: "TRY", current_value: manualValue, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [code, fundName, nav, units, manualValue, lookupFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitsN = parseFloat(units || "0");
  const totalTRY = hasNav && nav !== null && unitsN > 0 ? nav * unitsN : null;
  const tryUsd = usdPriceOf("TRY");
  const totalUsd = totalTRY !== null && tryUsd !== null ? totalTRY * tryUsd : null;
  const preview = previewLine(totalUsd, displayCurrency, rates);

  const navFmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "TRY", minimumFractionDigits: 4 }).format(n);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-600 leading-relaxed">{t("assetForm.fund.hint")}</p>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.fund.codeLabel")}</label>
        <div className="flex gap-2">
          <input value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); resetNav(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
            placeholder={t("assetForm.fund.codePlaceholder")}
            className={sharedInputClass + " uppercase"} />
          <button type="button" onClick={() => void lookup()} disabled={!code.trim() || fetching}
            className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-600/30 disabled:opacity-40 text-xs font-medium transition-colors">
            {fetching ? t("assetForm.fetching") : t("assetForm.lookup")}
          </button>
        </div>
      </div>

      {hasNav && nav !== null && (
        <>
          <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 px-3 py-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t("assetForm.fund.navLabel")}</span>
              <span className="text-sm text-emerald-300 font-semibold tabular-nums">{navFmt(nav)}</span>
            </div>
            {fundName && <p className="text-xs text-gray-500 truncate">{fundName}</p>}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.fund.unitsLabel")}</label>
            <input type="number" min="0" step="any" value={units} onChange={(e) => setUnits(e.target.value)}
              placeholder={t("assetForm.fund.unitsHint")} className={sharedInputClass} />
            {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
          </div>
        </>
      )}

      {lookupFailed && (
        <div>
          <p className="text-amber-400/80 text-xs mb-2">{t("assetForm.fund.lookupFailed")}</p>
          <div className="space-y-2">
            <input value={fundName} onChange={(e) => setFundName(e.target.value)}
              placeholder={t("assetForm.fund.namePlaceholder")} className={sharedInputClass} />
            <label className="block text-xs text-gray-400 mb-1">{t("assetForm.fund.totalValueLabel")}</label>
            <input type="number" min="0" step="0.01" value={manualValue} onChange={(e) => setManualValue(e.target.value)}
              placeholder="0.00" className={sharedInputClass} />
          </div>
        </div>
      )}
    </div>
  );
}

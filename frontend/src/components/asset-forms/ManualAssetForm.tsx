"use client";

import { useEffect, useState } from "react";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, MANUAL_CONFIGS, previewLine, sharedInputClass, useUsdRates } from "./shared";

// ── Bank account ────────────────────────────────────────────────────────────
const BANK_ACCOUNT_TYPES = [
  { value: "checking",      labelKey: "assetForm.bank.checking" },
  { value: "time_deposit",  labelKey: "assetForm.bank.timeDeposit" },
  { value: "participation", labelKey: "assetForm.bank.participation" },
] as const;

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

// ── Real estate ─────────────────────────────────────────────────────────────
const RE_TYPES = [
  { value: "konut",    emoji: "🏠", labelKey: "assetForm.re.konut" },
  { value: "isyeri",   emoji: "🏢", labelKey: "assetForm.re.isyeri" },
  { value: "arsa",     emoji: "🌿", labelKey: "assetForm.re.arsa" },
  { value: "other",    emoji: "🏨", labelKey: "assetForm.re.other" },
] as const;

// ── BES/pension ─────────────────────────────────────────────────────────────
function BesForm({ isPension, currency, fmtCcy, t, onDraftChange, displayCurrency, usdPriceOf, rates }: {
  isPension: boolean; currency: string; fmtCcy: (n: number) => string;
  t: (k: string) => string; onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null; rates: Record<string, number> | null;
}) {
  const [provider, setProvider] = useState("");
  const [monthlyContrib, setMonthlyContrib] = useState("");
  const [totalContrib, setTotalContrib] = useState("");
  const [actualValue, setActualValue] = useState("");
  const [retirementDate, setRetirementDate] = useState("");

  const totalN = parseFloat(totalContrib || "0") || 0;
  const stateMatch = isPension ? 0 : totalN * 0.30;
  const actualN = parseFloat(actualValue || "0") || 0;

  const effectiveValue = actualN || (isPension ? 0 : totalN + stateMatch);
  const usdVal = effectiveValue > 0 ? (currency === "USD" ? effectiveValue : (usdPriceOf(currency) ?? 0) * effectiveValue) : null;
  const preview = previewLine(usdVal, displayCurrency, rates);

  useEffect(() => {
    const v = actualN || (!isPension && totalN > 0 ? totalN + stateMatch : 0);
    if (v > 0) {
      const sd = buildSourceDetail({
        subtype: isPension ? "pension" : "bes",
        provider: provider.trim(),
        monthly_contribution: monthlyContrib,
        total_contributions: totalContrib,
        state_match: isPension ? "" : stateMatch.toFixed(2),
        retirement_date: retirementDate,
      });
      onDraftChange({ name: provider.trim() || (isPension ? "Emeklilik Fonu" : "BES"), asset_type: isPension ? "pension" : "bes", currency, current_value: v.toFixed(2), source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [provider, monthlyContrib, totalContrib, actualValue, retirementDate, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bes.provider")}</label>
        <input value={provider} onChange={(e) => setProvider(e.target.value)}
          placeholder={t("assetForm.bes.providerHint")} className={sharedInputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bes.monthly")}</label>
          <input type="number" min="0" step="0.01" value={monthlyContrib}
            onChange={(e) => setMonthlyContrib(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bes.total")}</label>
          <input type="number" min="0" step="0.01" value={totalContrib}
            onChange={(e) => setTotalContrib(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        </div>
      </div>

      {!isPension && totalN > 0 && (
        <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">{t("assetForm.bes.stateMatch")} <span className="text-gray-600">(katkının %30'u)</span></span>
            <span className="text-emerald-300 font-semibold tabular-nums">+ {fmtCcy(stateMatch)}</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bes.actualValue")}</label>
        <input type="number" min="0" step="0.01" value={actualValue}
          onChange={(e) => setActualValue(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.bes.actualValueHint")}</p>
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bes.retirementDate")} ({t("common.optional")})</label>
        <input type="date" value={retirementDate} onChange={(e) => setRetirementDate(e.target.value)} className={sharedInputClass} />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ManualAssetForm({ assetType, onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();
  const config = MANUAL_CONFIGS[assetType] ?? { slots: ["s"] as ("s" | "x")[] };

  const isBankAccount = assetType === "bank_account";
  const isRealEstate  = assetType === "real_estate";
  const isBes         = assetType === "bes";
  const isPension     = assetType === "pension";

  const [name,      setName]      = useState("");
  const [primary,   setPrimary]   = useState("");
  const [secondary, setSecondary] = useState("");
  const [currency,  setCurrency]  = useState("TRY");
  const [value,     setValue]     = useState("");

  // Bank account
  const [bankAccountType, setBankAccountType] = useState("checking");
  const [interestRate,    setInterestRate]    = useState("");
  const [maturityDate,    setMaturityDate]    = useState("");

  // Real estate
  const [reType, setReType] = useState("konut");
  const [reCity, setReCity] = useState("");

  const balanceN      = parseFloat(value || "0") || 0;
  const rateN         = parseFloat(interestRate || "0") || 0;
  const projectedValue = (bankAccountType === "time_deposit" || bankAccountType === "participation") && balanceN > 0 && rateN > 0
    ? balanceN * (1 + rateN / 100) : null;
  const daysLeft = daysUntil(maturityDate);

  const isEstimate = assetType === "vehicle";

  const effectiveValue = parseFloat(value || "0") || 0;
  const usdValue = (() => {
    if (effectiveValue <= 0) return null;
    if (currency.toUpperCase() === "USD") return effectiveValue;
    const r = usdPriceOf(currency);
    return r !== null ? effectiveValue * r : null;
  })();
  const preview = previewLine(usdValue, displayCurrency, rates);

  const fmtCcy = (n: number) => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
    catch { return `${n.toLocaleString()} ${currency}`; }
  };

  useEffect(() => {
    if (isBes || isPension) return; // handled by BesForm sub-component

    const hasName = name.trim().length > 0 || primary.trim().length > 0 || (isRealEstate && reType.length > 0);
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && hasName) {
      const sd = isRealEstate
        ? buildSourceDetail({ subtype: "real_estate", property_type: reType, city: reCity.trim() })
        : isBankAccount
          ? buildSourceDetail({ subtype: "bank_account", primary: primary.trim(), secondary: secondary.trim(), account_type: bankAccountType, interest_rate: bankAccountType !== "checking" ? interestRate : "", maturity_date: bankAccountType !== "checking" ? maturityDate : "" })
          : buildSourceDetail({ subtype: assetType, primary: primary.trim(), secondary: secondary.trim() });
      onDraftChange({ name: name.trim() || primary.trim() || t(`assetForm.re.${reType}`), asset_type: assetType, currency, current_value: value, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [name, primary, secondary, currency, value, bankAccountType, interestRate, maturityDate, reType, reCity, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  // BES/Pension — delegated to sub-component
  if (isBes || isPension) {
    return (
      <div className="space-y-4">
        {isPension && <p className="text-[11px] text-gray-500">{t("assetForm.bes.pensionNote")}</p>}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <BesForm isPension={isPension} currency={currency} fmtCcy={fmtCcy} t={t}
          onDraftChange={onDraftChange} displayCurrency={displayCurrency}
          usdPriceOf={usdPriceOf} rates={rates} />
      </div>
    );
  }

  // Real estate — simplified
  if (isRealEstate) {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.re.typeLabel")}</label>
          <div className="grid grid-cols-2 gap-2">
            {RE_TYPES.map((rt) => {
              const label = t(rt.labelKey) !== rt.labelKey ? t(rt.labelKey) : rt.value;
              return (
                <button key={rt.value} type="button" onClick={() => setReType(rt.value)}
                  className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${
                    reType === rt.value ? "bg-indigo-600/20 border-indigo-600/50 text-indigo-200" : "bg-[#0F0F0F] border-[#2A2A2A] text-gray-300 hover:border-indigo-700"
                  }`}>
                  {rt.emoji} {label}
                </button>
              );
            })}
          </div>
        </div>
        <input value={reCity} onChange={(e) => setReCity(e.target.value)}
          placeholder={`${t("assetForm.re.city")} (${t("common.optional")})`} className={sharedInputClass} />
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.estimatedValue")}</label>
          <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="0.00" className={sharedInputClass} />
          <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.re.hint")}</p>
          {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
        </div>
      </div>
    );
  }

  // All other manual types
  const k = (slot: string) => `assetForm.fields.${assetType}.${slot}`;
  const showSecondary = config.slots.includes("s") && !isBankAccount;
  const showTertiary  = config.slots.includes("x") && !isBankAccount;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.name")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={t("assetForm.namePlaceholder")} className={sharedInputClass} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t(k("primary"))}</label>
        <input value={primary} onChange={(e) => setPrimary(e.target.value)}
          placeholder={t(k("primary"))} className={sharedInputClass} />
      </div>

      {/* Bank account type */}
      {isBankAccount && (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bank.accountType")}</label>
            <div className="flex gap-1.5">
              {BANK_ACCOUNT_TYPES.map((bt) => {
                const label = t(bt.labelKey) !== bt.labelKey ? t(bt.labelKey) : bt.value;
                return (
                  <button key={bt.value} type="button" onClick={() => setBankAccountType(bt.value)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                      bankAccountType === bt.value ? "bg-indigo-600/20 border-indigo-600/50 text-indigo-300" : "bg-[#0F0F0F] border-[#2A2A2A] text-gray-400 hover:border-indigo-700"
                    }`}>{label}</button>
                );
              })}
            </div>
          </div>
          <input value={secondary} onChange={(e) => setSecondary(e.target.value)}
            placeholder={`${t("assetForm.fields.bank_account.secondary")} (${t("common.optional")})`}
            className={sharedInputClass} />
        </>
      )}

      {(showSecondary || showTertiary) && (
        <div className="grid grid-cols-2 gap-3">
          {showSecondary && (
            <input value={secondary} onChange={(e) => setSecondary(e.target.value)}
              placeholder={`${t(k("secondary"))} (${t("common.optional")})`} className={sharedInputClass} />
          )}
          {showTertiary && (
            <input value={secondary} onChange={(e) => setSecondary(e.target.value)}
              placeholder={`${t(k("tertiary"))} (${t("common.optional")})`} className={sharedInputClass} />
          )}
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {isBankAccount ? t("assetForm.bank.balance") : t("assetForm.estimatedValue")}
        </label>
        <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="0.00" className={sharedInputClass} />
        {isEstimate && <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.estimateHint")}</p>}
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>

      {isBankAccount && (bankAccountType === "time_deposit" || bankAccountType === "participation") && (
        <div className="space-y-3 rounded-lg bg-amber-950/10 border border-amber-900/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                {bankAccountType === "participation" ? t("assetForm.bank.profitRate") : t("assetForm.bank.interestRate")}
              </label>
              <div className="relative">
                <input type="number" min="0" step="0.01" value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)} placeholder="0.00"
                  className={sharedInputClass + " pr-6"} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">%</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bank.maturityDate")}</label>
              <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={sharedInputClass} />
            </div>
          </div>
          {projectedValue !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{t("assetForm.bank.projectedValue")}</span>
              <span className="text-amber-300 font-semibold tabular-nums">{fmtCcy(projectedValue)}</span>
            </div>
          )}
          {daysLeft !== null && daysLeft > 0 && (
            <p className="text-[11px] text-gray-600">{t("assetForm.bank.daysLeft").replace("{n}", String(daysLeft))}</p>
          )}
          {daysLeft !== null && daysLeft <= 0 && (
            <p className="text-[11px] text-amber-500">{t("assetForm.bank.matured")}</p>
          )}
        </div>
      )}
    </div>
  );
}

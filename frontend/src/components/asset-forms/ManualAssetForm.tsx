"use client";

import { useEffect, useState } from "react";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, MANUAL_CONFIGS, previewLine, sharedInputClass, useUsdRates } from "./shared";

const BANK_ACCOUNT_TYPES = [
  { value: "checking", labelKey: "assetForm.bank.checking" },
  { value: "time_deposit", labelKey: "assetForm.bank.timeDeposit" },
  { value: "participation", labelKey: "assetForm.bank.participation" },
] as const;

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

export default function ManualAssetForm({ assetType, onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();
  const config = MANUAL_CONFIGS[assetType] ?? { slots: ["s"] as ("s" | "x")[] };
  const isBes = assetType === "bes";
  const isBankAccount = assetType === "bank_account";

  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("");       // bank: institution
  const [secondary, setSecondary] = useState("");   // bank: account number / label
  const [currency, setCurrency] = useState("TRY");
  const [value, setValue] = useState("");

  // BES
  const [contribution, setContribution] = useState("");
  const stateMatch = isBes ? (parseFloat(contribution || "0") || 0) * 0.3 : 0;
  const besTotal = isBes ? (parseFloat(contribution || "0") || 0) + stateMatch : 0;

  // Bank account specifics
  const [bankAccountType, setBankAccountType] = useState("checking");
  const [interestRate, setInterestRate] = useState("");
  const [maturityDate, setMaturityDate] = useState("");

  // Projected value for time_deposit / participation
  const balanceN = parseFloat(value || "0") || 0;
  const rateN = parseFloat(interestRate || "0") || 0;
  const projectedValue = (bankAccountType === "time_deposit" || bankAccountType === "participation") && balanceN > 0 && rateN > 0
    ? balanceN * (1 + rateN / 100)
    : null;

  const daysLeft = daysUntil(maturityDate);
  const isEstimate = assetType === "real_estate" || assetType === "vehicle";

  // Preview in displayCurrency (convert via USD)
  const effectiveValue = isBes ? besTotal : parseFloat(value || "0") || 0;
  const usdValue = (() => {
    if (effectiveValue <= 0) return null;
    if (currency.toUpperCase() === "USD") return effectiveValue;
    const r = usdPriceOf(currency);
    return r !== null ? effectiveValue * r : null;
  })();
  const preview = previewLine(usdValue, displayCurrency, rates);

  useEffect(() => {
    const hasName = name.trim().length > 0 || primary.trim().length > 0;
    const effectiveV = isBes ? besTotal.toFixed(2) : value;
    const v = parseFloat(effectiveV);
    if (!isNaN(v) && v > 0 && hasName) {
      let sdExtra: Record<string, string> = {};
      if (isBankAccount) {
        sdExtra = { account_type: bankAccountType };
        if (bankAccountType !== "checking") {
          if (interestRate) sdExtra.interest_rate = interestRate;
          if (maturityDate) sdExtra.maturity_date = maturityDate;
        }
      }
      const sd = isBes
        ? buildSourceDetail({ subtype: "bes", provider: primary.trim(), plan: secondary.trim(), contribution, state_match: stateMatch.toFixed(2) })
        : buildSourceDetail({ subtype: assetType, primary: primary.trim(), secondary: secondary.trim(), account_type: sdExtra.account_type ?? "", interest_rate: sdExtra.interest_rate ?? "", maturity_date: sdExtra.maturity_date ?? "" });
      onDraftChange({ name: name.trim() || primary.trim(), asset_type: assetType, currency, current_value: effectiveV, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [name, primary, secondary, currency, value, contribution, bankAccountType, interestRate, maturityDate, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = (slot: string) => `assetForm.fields.${assetType}.${slot}`;
  const showSecondary = config.slots.includes("s") && !isBankAccount;
  const showTertiary = config.slots.includes("x") && !isBankAccount;

  const fmtCcy = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${n.toLocaleString()} ${currency}`;
    }
  };

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

      {/* Bank account type selector */}
      {isBankAccount && (
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bank.accountType")}</label>
          <div className="flex gap-1.5">
            {BANK_ACCOUNT_TYPES.map((bt) => {
              const label = t(bt.labelKey) !== bt.labelKey ? t(bt.labelKey) : bt.value;
              return (
                <button key={bt.value} type="button"
                  onClick={() => setBankAccountType(bt.value)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                    bankAccountType === bt.value
                      ? "bg-indigo-600/20 border-indigo-600/50 text-indigo-300"
                      : "bg-[#0F0F0F] border-[#2A2A2A] text-gray-400 hover:border-indigo-700"
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bank label / account number */}
      {isBankAccount && (
        <input value={secondary} onChange={(e) => setSecondary(e.target.value)}
          placeholder={`${t("assetForm.fields.bank_account.secondary")} (${t("common.optional")})`}
          className={sharedInputClass} />
      )}

      {/* Other manual types: secondary + tertiary */}
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

      {isBes ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.besContribution")}</label>
            <input type="number" min="0" step="0.01" value={contribution}
              onChange={(e) => setContribution(e.target.value)} placeholder="0.00" className={sharedInputClass} />
          </div>
          {besTotal > 0 && (
            <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 px-3 py-2.5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{t("assetForm.besStateMatch")}</span>
                <span className="text-emerald-300 font-semibold tabular-nums">+ {fmtCcy(stateMatch)}</span>
              </div>
              <div className="flex items-center justify-between text-sm pt-1 border-t border-emerald-900/30">
                <span className="text-gray-300">{t("assetForm.besTotal")}</span>
                <span className="text-white font-semibold tabular-nums">{fmtCcy(besTotal)}</span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-600 leading-relaxed">{t("assetForm.besNote")}</p>
        </div>
      ) : (
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            {isBankAccount ? t("assetForm.bank.balance") : t("assetForm.estimatedValue")}
          </label>
          <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="0.00" className={sharedInputClass} />
          {isEstimate && <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.estimateHint")}</p>}
          {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
        </div>
      )}

      {/* Time deposit / participation extra fields */}
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
              <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)}
                className={sharedInputClass} />
            </div>
          </div>

          {projectedValue !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{t("assetForm.bank.projectedValue")}</span>
              <span className="text-amber-300 font-semibold tabular-nums">{fmtCcy(projectedValue)}</span>
            </div>
          )}
          {daysLeft !== null && daysLeft > 0 && (
            <p className="text-[11px] text-gray-600">
              {t("assetForm.bank.daysLeft").replace("{n}", String(daysLeft))}
            </p>
          )}
          {daysLeft !== null && daysLeft <= 0 && (
            <p className="text-[11px] text-amber-500">{t("assetForm.bank.matured")}</p>
          )}
        </div>
      )}
    </div>
  );
}

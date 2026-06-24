"use client";

import { useEffect, useState } from "react";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, MANUAL_CONFIGS, previewLine, sharedInputClass, useUsdRates } from "./shared";

// ── Bank account ─────────────────────────────────────────────────────────────
const BANK_ACCOUNT_TYPES = [
  { value: "checking",      labelKey: "assetForm.bank.checking" },
  { value: "time_deposit",  labelKey: "assetForm.bank.timeDeposit" },
  { value: "participation", labelKey: "assetForm.bank.participation" },
] as const;

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

// ── Real estate ──────────────────────────────────────────────────────────────
const RE_TYPES = [
  { value: "residential", emoji: "🏠", labelKey: "assetForm.re.residential" },
  { value: "commercial",  emoji: "🏢", labelKey: "assetForm.re.commercial" },
  { value: "land",        emoji: "🌿", labelKey: "assetForm.re.land" },
  { value: "other",       emoji: "🏨", labelKey: "assetForm.re.other" },
] as const;

// ── Vehicle ───────────────────────────────────────────────────────────────────
function VehicleForm({ onDraftChange, displayCurrency, usdPriceOf, rates, t }: {
  onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null;
  rates: Record<string, number> | null; t: (k: string) => string;
}) {
  const [brand, setBrand]   = useState("");
  const [model, setModel]   = useState("");
  const [year, setYear]     = useState("");
  const [value, setValue]   = useState("");
  const [currency, setCurrency] = useState(displayCurrency);

  const valueN = parseFloat(value || "0") || 0;
  const usdVal = valueN > 0 ? (currency === "USD" ? valueN : (usdPriceOf(currency) ?? 0) * valueN) : null;
  const preview = previewLine(usdVal, displayCurrency, rates);

  useEffect(() => {
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && brand.trim().length > 0) {
      const assetName = [brand.trim(), model.trim(), year.trim()].filter(Boolean).join(" ");
      onDraftChange({
        name: assetName,
        asset_type: "vehicle",
        currency,
        current_value: value,
        source_detail: buildSourceDetail({ subtype: "vehicle", brand: brand.trim(), model: model.trim(), year: year.trim() }),
      });
    } else {
      onDraftChange(null);
    }
  }, [brand, model, year, value, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.vehicle.brand")}</label>
          <input value={brand} onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. Toyota" className={sharedInputClass} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.vehicle.model")}</label>
          <input value={model} onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Corolla" className={sharedInputClass} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.vehicle.year")}</label>
          <input type="number" min="1900" max="2030" value={year} onChange={(e) => setYear(e.target.value)}
            placeholder="2020" className={sharedInputClass} />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.estimatedValue")}</label>
        <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="0.00" className={sharedInputClass} />
        <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.vehicle.depreciationNote")}</p>
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>
    </div>
  );
}

// ── BES / pension ─────────────────────────────────────────────────────────────
function BesForm({ isPension, currency, fmtCcy, t, onDraftChange, displayCurrency, usdPriceOf, rates }: {
  isPension: boolean; currency: string; fmtCcy: (n: number) => string;
  t: (k: string) => string; onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null; rates: Record<string, number> | null;
}) {
  const [provider, setProvider]           = useState("");
  const [monthlyContrib, setMonthlyContrib] = useState("");
  const [totalContrib, setTotalContrib]   = useState("");
  const [actualValue, setActualValue]     = useState("");
  const [retirementDate, setRetirementDate] = useState("");

  const totalN     = parseFloat(totalContrib || "0") || 0;
  const stateMatch = isPension ? 0 : totalN * 0.30;
  const actualN    = parseFloat(actualValue || "0") || 0;

  const effectiveValue = actualN || (isPension ? 0 : totalN + stateMatch);
  const usdVal  = effectiveValue > 0 ? (currency === "USD" ? effectiveValue : (usdPriceOf(currency) ?? 0) * effectiveValue) : null;
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
      onDraftChange({ name: provider.trim() || (isPension ? "Pension Fund" : "BES"), asset_type: isPension ? "pension" : "bes", currency, current_value: v.toFixed(2), source_detail: sd });
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
            <span className="text-gray-400">{t("assetForm.bes.stateMatch")} <span className="text-gray-600">(30%)</span></span>
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

// ── Bond ──────────────────────────────────────────────────────────────────────
function BondForm({ onDraftChange, displayCurrency, usdPriceOf, rates, t }: {
  onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null;
  rates: Record<string, number> | null; t: (k: string) => string;
}) {
  const [issuer, setIssuer]           = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [couponRate, setCouponRate]   = useState("");
  const [faceValue, setFaceValue]     = useState("");
  const [note, setNote]               = useState("");
  const [currency, setCurrency]       = useState(displayCurrency);

  const faceN = parseFloat(faceValue || "0") || 0;
  const usdVal = faceN > 0 ? (currency === "USD" ? faceN : (usdPriceOf(currency) ?? 0) * faceN) : null;
  const preview = previewLine(usdVal, displayCurrency, rates);

  useEffect(() => {
    const v = parseFloat(faceValue);
    if (!isNaN(v) && v > 0 && issuer.trim().length > 0) {
      onDraftChange({
        name: issuer.trim(),
        asset_type: "bond",
        currency,
        current_value: faceValue,
        source_detail: buildSourceDetail({ subtype: "bond", issuer: issuer.trim(), maturity_date: maturityDate, coupon_rate: couponRate, note: note.trim() }),
      });
    } else {
      onDraftChange(null);
    }
  }, [issuer, maturityDate, couponRate, faceValue, note, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.fields.bond.primary")}</label>
        <input value={issuer} onChange={(e) => setIssuer(e.target.value)}
          placeholder="e.g. US Treasury, Apple Inc." className={sharedInputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bond.couponRate")}</label>
          <div className="relative">
            <input type="number" min="0" step="0.01" value={couponRate}
              onChange={(e) => setCouponRate(e.target.value)} placeholder="0.00"
              className={sharedInputClass + " pr-6"} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">%</span>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bond.maturityDate")}</label>
          <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={sharedInputClass} />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bond.faceValue")}</label>
        <input type="number" min="0" step="0.01" value={faceValue}
          onChange={(e) => setFaceValue(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.bond.note")}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="ISIN, series, custodian..." className={sharedInputClass} />
      </div>
    </div>
  );
}

// ── Life insurance ────────────────────────────────────────────────────────────
function LifeInsuranceForm({ onDraftChange, displayCurrency, usdPriceOf, rates, t }: {
  onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null;
  rates: Record<string, number> | null; t: (k: string) => string;
}) {
  const [provider, setProvider]         = useState("");
  const [coverage, setCoverage]         = useState("");
  const [monthlyPremium, setMonthlyPremium] = useState("");
  const [currency, setCurrency]         = useState(displayCurrency);

  const coverageN = parseFloat(coverage || "0") || 0;
  const usdVal = coverageN > 0 ? (currency === "USD" ? coverageN : (usdPriceOf(currency) ?? 0) * coverageN) : null;
  const preview = previewLine(usdVal, displayCurrency, rates);

  useEffect(() => {
    const v = parseFloat(coverage);
    if (!isNaN(v) && v > 0 && provider.trim().length > 0) {
      onDraftChange({
        name: provider.trim(),
        asset_type: "life_insurance",
        currency,
        current_value: coverage,
        source_detail: buildSourceDetail({ subtype: "life_insurance", provider: provider.trim(), monthly_premium: monthlyPremium }),
      });
    } else {
      onDraftChange(null);
    }
  }, [provider, coverage, monthlyPremium, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.fields.life_insurance.primary")}</label>
        <input value={provider} onChange={(e) => setProvider(e.target.value)}
          placeholder="e.g. Allianz, MetLife..." className={sharedInputClass} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.life.coverageAmount")}</label>
        <input type="number" min="0" step="0.01" value={coverage}
          onChange={(e) => setCoverage(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.life.monthlyPremium")}</label>
        <input type="number" min="0" step="0.01" value={monthlyPremium}
          onChange={(e) => setMonthlyPremium(e.target.value)} placeholder="0.00" className={sharedInputClass} />
      </div>
    </div>
  );
}

// ── Business ownership ────────────────────────────────────────────────────────
function BusinessOwnershipForm({ onDraftChange, displayCurrency, usdPriceOf, rates, t }: {
  onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null;
  rates: Record<string, number> | null; t: (k: string) => string;
}) {
  const [company, setCompany]   = useState("");
  const [pct, setPct]           = useState("");
  const [value, setValue]       = useState("");
  const [currency, setCurrency] = useState(displayCurrency);

  const valueN = parseFloat(value || "0") || 0;
  const usdVal = valueN > 0 ? (currency === "USD" ? valueN : (usdPriceOf(currency) ?? 0) * valueN) : null;
  const preview = previewLine(usdVal, displayCurrency, rates);

  useEffect(() => {
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && company.trim().length > 0) {
      onDraftChange({
        name: company.trim(),
        asset_type: "business_ownership",
        currency,
        current_value: value,
        source_detail: buildSourceDetail({ subtype: "business_ownership", company: company.trim(), pct: pct.trim() }),
      });
    } else {
      onDraftChange(null);
    }
  }, [company, pct, value, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.fields.business_ownership.primary")}</label>
        <input value={company} onChange={(e) => setCompany(e.target.value)}
          placeholder="e.g. Acme Ltd." className={sharedInputClass} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.business.ownershipPct")}</label>
        <div className="relative">
          <input type="number" min="0" max="100" step="0.1" value={pct}
            onChange={(e) => setPct(e.target.value)} placeholder="e.g. 25"
            className={sharedInputClass + " pr-6"} />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">%</span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.estimatedValue")}</label>
        <input type="number" min="0" step="0.01" value={value}
          onChange={(e) => setValue(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.estimateHint")}</p>
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>
    </div>
  );
}

// ── Art / collectible / jewelry ───────────────────────────────────────────────
function ArtJewelryForm({ assetType, onDraftChange, displayCurrency, usdPriceOf, rates, t }: {
  assetType: string; onDraftChange: (d: import("./shared").AssetDraft | null) => void;
  displayCurrency: string; usdPriceOf: (c: string) => number | null;
  rates: Record<string, number> | null; t: (k: string) => string;
}) {
  const [itemName, setItemName]         = useState("");
  const [insuranceVal, setInsuranceVal] = useState("");
  const [value, setValue]               = useState("");
  const [currency, setCurrency]         = useState(displayCurrency);

  const valueN = parseFloat(value || "0") || 0;
  const usdVal = valueN > 0 ? (currency === "USD" ? valueN : (usdPriceOf(currency) ?? 0) * valueN) : null;
  const preview = previewLine(usdVal, displayCurrency, rates);

  useEffect(() => {
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && itemName.trim().length > 0) {
      onDraftChange({
        name: itemName.trim(),
        asset_type: assetType,
        currency,
        current_value: value,
        source_detail: buildSourceDetail({ subtype: assetType, item: itemName.trim(), insurance_value: insuranceVal }),
      });
    } else {
      onDraftChange(null);
    }
  }, [itemName, insuranceVal, value, currency, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  const isJewelry = assetType === "jewelry";
  const primaryKey = isJewelry ? "assetForm.fields.jewelry.primary" : "assetForm.fields.art_collectible.primary";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t(primaryKey)}</label>
        <input value={itemName} onChange={(e) => setItemName(e.target.value)}
          placeholder={isJewelry ? "e.g. Gold ring, Diamond necklace" : "e.g. Oil painting, Vintage watch"}
          className={sharedInputClass} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.estimatedValue")}</label>
        <input type="number" min="0" step="0.01" value={value}
          onChange={(e) => setValue(e.target.value)} placeholder="0.00" className={sharedInputClass} />
        <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.estimateHint")}</p>
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.art.insuranceValue")}</label>
        <input type="number" min="0" step="0.01" value={insuranceVal}
          onChange={(e) => setInsuranceVal(e.target.value)} placeholder="0.00" className={sharedInputClass} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ManualAssetForm({ assetType, onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();
  const config = MANUAL_CONFIGS[assetType] ?? { slots: ["s"] as ("s" | "x")[] };

  const isBankAccount = assetType === "bank_account";
  const isRealEstate  = assetType === "real_estate";
  const isVehicle     = assetType === "vehicle";
  const isBes         = assetType === "bes";
  const isPension     = assetType === "pension";
  const isBond        = assetType === "bond";
  const isLifeIns     = assetType === "life_insurance";
  const isBusiness    = assetType === "business_ownership";
  const isArtJewelry  = assetType === "art_collectible" || assetType === "jewelry";

  const [name,      setName]      = useState("");
  const [primary,   setPrimary]   = useState("");
  const [secondary, setSecondary] = useState("");
  const [tertiary,  setTertiary]  = useState("");
  const [currency,  setCurrency]  = useState(displayCurrency);
  const [value,     setValue]     = useState("");

  // Bank account
  const [bankAccountType, setBankAccountType] = useState("checking");
  const [interestRate,    setInterestRate]    = useState("");
  const [maturityDate,    setMaturityDate]    = useState("");

  // Real estate
  const [reType, setReType] = useState("residential");
  const [reCity, setReCity] = useState("");
  const [reSqm,  setReSqm]  = useState("");

  const balanceN       = parseFloat(value || "0") || 0;
  const rateN          = parseFloat(interestRate || "0") || 0;
  const projectedValue = (bankAccountType === "time_deposit" || bankAccountType === "participation") && balanceN > 0 && rateN > 0
    ? balanceN * (1 + rateN / 100) : null;
  const daysLeft = daysUntil(maturityDate);

  const effectiveValue = parseFloat(value || "0") || 0;
  const usdValue = (() => {
    if (effectiveValue <= 0) return null;
    if (currency.toUpperCase() === "USD") return effectiveValue;
    const r = usdPriceOf(currency);
    return r !== null ? effectiveValue * r : null;
  })();
  const preview = previewLine(usdValue, displayCurrency, rates);

  // Price per m² for real estate
  const sqmN = parseFloat(reSqm || "0") || 0;
  const pricePerSqm = sqmN > 0 && effectiveValue > 0 ? effectiveValue / sqmN : null;

  const fmtCcy = (n: number) => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
    catch { return `${n.toLocaleString()} ${currency}`; }
  };

  useEffect(() => {
    if (isBes || isPension || isVehicle || isBond || isLifeIns || isBusiness || isArtJewelry) return;

    const hasName = name.trim().length > 0 || primary.trim().length > 0 || (isRealEstate && reType.length > 0);
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && hasName) {
      const sd = isRealEstate
        ? buildSourceDetail({ subtype: "real_estate", property_type: reType, city: reCity.trim(), sqm: reSqm.trim() })
        : isBankAccount
          ? buildSourceDetail({ subtype: "bank_account", primary: primary.trim(), secondary: secondary.trim(), tertiary: tertiary.trim(), account_type: bankAccountType, interest_rate: bankAccountType !== "checking" ? interestRate : "", maturity_date: bankAccountType !== "checking" ? maturityDate : "" })
          : buildSourceDetail({ subtype: assetType, primary: primary.trim(), secondary: secondary.trim(), tertiary: tertiary.trim() });
      onDraftChange({ name: name.trim() || primary.trim() || t(`assetForm.re.${reType}`), asset_type: assetType, currency, current_value: value, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [name, primary, secondary, tertiary, currency, value, bankAccountType, interestRate, maturityDate, reType, reCity, reSqm, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dedicated sub-form routing ───────────────────────────────────────────
  const sharedDelegateProps = { onDraftChange, displayCurrency, usdPriceOf, rates, t };

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

  if (isVehicle)    return <VehicleForm {...sharedDelegateProps} />;
  if (isBond)       return <BondForm {...sharedDelegateProps} />;
  if (isLifeIns)    return <LifeInsuranceForm {...sharedDelegateProps} />;
  if (isBusiness)   return <BusinessOwnershipForm {...sharedDelegateProps} />;
  if (isArtJewelry) return <ArtJewelryForm assetType={assetType} {...sharedDelegateProps} />;

  // ── Real estate ──────────────────────────────────────────────────────────
  if (isRealEstate) {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.re.typeLabel")}</label>
          <div className="grid grid-cols-2 gap-2">
            {RE_TYPES.map((rt) => (
              <button key={rt.value} type="button" onClick={() => setReType(rt.value)}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${
                  reType === rt.value ? "bg-indigo-600/20 border-indigo-600/50 text-indigo-200" : "bg-[#11100E] border-[#2C2922] text-gray-300 hover:border-indigo-700"
                }`}>
                {rt.emoji} {t(rt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <input value={reCity} onChange={(e) => setReCity(e.target.value)}
            placeholder={`${t("assetForm.re.city")} (${t("common.optional")})`} className={sharedInputClass} />
          <input type="number" min="0" step="any" value={reSqm} onChange={(e) => setReSqm(e.target.value)}
            placeholder={`${t("assetForm.re.size")} (${t("common.optional")})`} className={sharedInputClass} />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("common.currency")}</label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.estimatedValue")}</label>
          <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="0.00" className={sharedInputClass} />
          <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.re.hint")}</p>
          {pricePerSqm !== null && (
            <p className="text-xs text-gray-500 mt-1">
              {t("assetForm.re.pricePerSqm")}: {fmtCcy(pricePerSqm)} / m²
            </p>
          )}
          {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
        </div>
      </div>
    );
  }

  // ── All other manual types (cash, pension-generic, other_asset) ──────────
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
                      bankAccountType === bt.value ? "bg-indigo-600/20 border-indigo-600/50 text-indigo-300" : "bg-[#11100E] border-[#2C2922] text-gray-400 hover:border-indigo-700"
                    }`}>{label}</button>
                );
              })}
            </div>
          </div>
          <input value={secondary} onChange={(e) => setSecondary(e.target.value)}
            placeholder={`${t("assetForm.fields.bank_account.secondary")} (${t("common.optional")})`}
            className={sharedInputClass} />
          <input value={tertiary} onChange={(e) => setTertiary(e.target.value)}
            placeholder={`${t("assetForm.fields.bank_account.tertiary")} (${t("common.optional")})`}
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
            <input value={tertiary} onChange={(e) => setTertiary(e.target.value)}
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

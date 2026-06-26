"use client";

import { useEffect, useState } from "react";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates } from "./shared";

/**
 * One universal form for every manual asset type.
 *
 * WHY: tracking net worth only needs two things — what it is and what it's worth.
 * The old per-type forms asked for interest rates, maturities, ISINs, coupon rates,
 * ownership %, square metres, insurance values, providers… almost none of which the
 * user actually wants to fill in just to see a number on their net-worth page. Stripping
 * them to name + value + currency removes the friction; precision can come later from a
 * statement upload or an edit.
 */

// Friendly per-type example placeholders — guidance only; everything is free text.
const NAME_EXAMPLE: Record<string, string> = {
  cash: "Wallet, safe, envelope…",
  bank_account: "Checking · main bank",
  real_estate: "Apartment, land, rental…",
  vehicle: "Toyota Corolla 2020",
  bond: "Treasury bond 2030",
  life_insurance: "Life policy",
  pension: "Pension fund",
  business_ownership: "Acme Ltd. (25%)",
  art_collectible: "Painting, watch, antique…",
  jewelry: "Gold ring, necklace…",
  other_asset: "Anything you own",
};

export default function ManualAssetForm({ assetType, onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(displayCurrency);
  const [value, setValue] = useState("");

  const valueN = parseFloat(value || "0") || 0;
  const usdValue = (() => {
    if (valueN <= 0) return null;
    if (currency.toUpperCase() === "USD") return valueN;
    const r = usdPriceOf(currency);
    return r !== null ? valueN * r : null;
  })();
  const preview = previewLine(usdValue, displayCurrency, rates);

  useEffect(() => {
    if (valueN > 0 && name.trim().length > 0) {
      onDraftChange({
        name: name.trim(),
        asset_type: assetType,
        currency,
        current_value: value,
        // Keep the subtype so the page knows the kind; no field zoo to store.
        source_detail: buildSourceDetail({ subtype: assetType }),
      });
    } else {
      onDraftChange(null);
    }
  }, [name, currency, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.namePrompt")}</label>
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder={NAME_EXAMPLE[assetType] ?? t("assetForm.namePlaceholder")}
          className={sharedInputClass}
        />
      </div>

      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("common.currency")}</label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.value")}</label>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
          className={sharedInputClass}
        />
        <p className="text-[11px] text-ink-mute mt-1.5">{t("assetForm.valueHint")}</p>
        {preview && <p className="text-pos text-xs mt-1.5">{preview}</p>}
      </div>
    </div>
  );
}

"use client";

/**
 * Shared contracts + helpers for the per-type Add Asset sub-forms.
 *
 * Storage contract the backend net-worth summary relies on:
 *  - crypto / foreign_currency / commodity  → current_value = quantity, currency = asset code
 *  - gold                                    → current_value = troy-oz of PURE gold, currency = "XAU"
 *  - stock / fund                            → current_value = total value, currency = quote currency
 *  - everything else (manual)                → current_value = total value, currency = chosen fiat
 */

import { useEffect, useState } from "react";
import { getCurrencyRates } from "@/lib/api";

export interface AssetDraft {
  name: string;
  asset_type: string;
  currency: string;
  current_value: string; // numeric string
  source_detail?: string; // JSON string
}

export interface AssetFormProps {
  assetType: string;
  onDraftChange: (draft: AssetDraft | null) => void;
}

export const sharedInputClass =
  "w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600";

export function buildSourceDetail(detail: Record<string, string | number | undefined>): string {
  const cleaned = Object.fromEntries(
    Object.entries(detail).filter(([, v]) => v !== undefined && String(v).trim().length > 0),
  );
  return JSON.stringify(cleaned);
}

// Popular coins shown as quick-select chips (symbols must match CoinGecko codes).
export const TOP_CRYPTO = ["BTC", "ETH", "USDT", "SOL", "BNB", "XRP", "ADA", "DOGE"];

// Troy ounces of PURE gold per 1 unit. Coin figures are standard approximations.
export interface GoldUnit {
  code: string;
  labelKey: string;
  unitKey: string; // "gram" | "piece" | "troyOz" | "kilo"
  xauPerUnit: number;
}

export const GOLD_UNITS: GoldUnit[] = [
  { code: "GRAM_24K", labelKey: "gram_24k", unitKey: "gram", xauPerUnit: 1 / 31.1035 },
  { code: "GRAM_22K", labelKey: "gram_22k", unitKey: "gram", xauPerUnit: (22 / 24) / 31.1035 },
  { code: "GRAM_18K", labelKey: "gram_18k", unitKey: "gram", xauPerUnit: 0.75 / 31.1035 },
  { code: "TROY_OZ", labelKey: "troy_oz", unitKey: "troyOz", xauPerUnit: 1 },
  { code: "KILOGRAM_BAR", labelKey: "kilogram_bar", unitKey: "kilo", xauPerUnit: 1000 / 31.1035 },
  { code: "SOVEREIGN", labelKey: "sovereign", unitKey: "piece", xauPerUnit: 0.2354 },
  { code: "AMERICAN_EAGLE", labelKey: "american_eagle", unitKey: "piece", xauPerUnit: 1 },
  { code: "MAPLE_LEAF", labelKey: "maple_leaf", unitKey: "piece", xauPerUnit: 1 },
  { code: "KRUGERRAND", labelKey: "krugerrand", unitKey: "piece", xauPerUnit: 1 },
  { code: "QUARTER_COIN", labelKey: "quarter_coin", unitKey: "piece", xauPerUnit: 0.0531 },
  { code: "HALF_COIN", labelKey: "half_coin", unitKey: "piece", xauPerUnit: 0.1061 },
  { code: "FULL_COIN", labelKey: "full_coin", unitKey: "piece", xauPerUnit: 0.2122 },
];

// Manual asset types → which optional slots their form shows + value-label key.
// primary (p) is always required; secondary (s) / tertiary (x) optional.
export interface ManualConfig {
  slots: ("s" | "x")[];
}

export const MANUAL_CONFIGS: Record<string, ManualConfig> = {
  cash: { slots: ["s"] },
  bank_account: { slots: ["s", "x"] },
  real_estate: { slots: ["s", "x"] },
  vehicle: { slots: ["s", "x"] },
  bond: { slots: ["s", "x"] },
  art_collectible: { slots: ["s", "x"] },
  jewelry: { slots: ["s", "x"] },
  life_insurance: { slots: ["s", "x"] },
  pension: { slots: ["s"] },
  business_ownership: { slots: ["s", "x"] },
  other_asset: { slots: ["s"] },
};

/**
 * Live USD rates: getCurrencyRates("USD") returns rates[code] = units of `code` per 1 USD.
 * So USD price of one unit of `code` = 1 / rates[code]. Works for fiat, crypto and commodities.
 */
export function useUsdRates() {
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    getCurrencyRates("USD")
      .then((r) => { if (alive) setRates(r); })
      .catch(() => { if (alive) setRates(null); });
    return () => { alive = false; };
  }, []);

  const usdPriceOf = (code: string): number | null => {
    if (!rates) return null;
    const r = rates[code.toUpperCase()];
    if (!r || r <= 0) return null;
    return 1 / r;
  };

  return {
    ready: rates !== null,
    usdPriceOf,
    tryPerUsd: rates?.["TRY"] ?? null,
  };
}

const usdFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "≈ 12,345 ₺ · $410" — a dual TRY/USD preview line. Returns null if no USD value. */
export function previewLine(usdValue: number | null, tryPerUsd: number | null): string | null {
  if (usdValue === null || !isFinite(usdValue)) return null;
  const usd = `$${usdFmt.format(usdValue)}`;
  if (tryPerUsd) {
    const tryVal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(usdValue * tryPerUsd);
    return `≈ ${tryVal} ₺ · ${usd}`;
  }
  return `≈ ${usd}`;
}

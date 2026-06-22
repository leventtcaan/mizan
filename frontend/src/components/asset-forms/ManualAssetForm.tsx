"use client";

import { useEffect, useState } from "react";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, MANUAL_CONFIGS, sharedInputClass } from "./shared";

/**
 * Config-driven form for every manual (no-live-price) asset type.
 * BES gets a dedicated contribution + state-match helper.
 */
export default function ManualAssetForm({ assetType, onDraftChange }: AssetFormProps) {
  const { t } = useLanguage();
  const config = MANUAL_CONFIGS[assetType] ?? { slots: ["s"] as ("s" | "x")[] };
  const isBes = assetType === "bes";

  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [tertiary, setTertiary] = useState("");
  const [currency, setCurrency] = useState(isBes ? "TRY" : "TRY");
  const [value, setValue] = useState("");

  // BES-specific
  const [contribution, setContribution] = useState("");
  const stateMatch = isBes ? (parseFloat(contribution || "0") || 0) * 0.3 : 0;
  const besTotal = isBes ? (parseFloat(contribution || "0") || 0) + stateMatch : 0;

  useEffect(() => {
    const effectiveValue = isBes ? besTotal.toFixed(2) : value;
    const v = parseFloat(effectiveValue);
    const hasName = name.trim().length > 0 || primary.trim().length > 0;
    if (!isNaN(v) && v > 0 && hasName) {
      onDraftChange({
        name: name.trim() || primary.trim(),
        asset_type: assetType,
        currency,
        current_value: effectiveValue,
        source_detail: buildSourceDetail(
          isBes
            ? { subtype: "bes", provider: primary.trim(), plan: secondary.trim(), contribution, state_match: stateMatch.toFixed(2) }
            : { subtype: assetType, primary: primary.trim(), secondary: secondary.trim(), tertiary: tertiary.trim() },
        ),
      });
    } else {
      onDraftChange(null);
    }
  }, [name, primary, secondary, tertiary, currency, value, contribution, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = (slot: string) => `assetForm.fields.${assetType}.${slot}`;
  const showSecondary = config.slots.includes("s");
  const showTertiary = config.slots.includes("x");
  const estimateHint = assetType === "real_estate" || assetType === "vehicle";

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
                <span className="text-emerald-300 font-semibold tabular-nums">
                  + {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(stateMatch)} {currency}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm pt-1 border-t border-emerald-900/30">
                <span className="text-gray-300">{t("assetForm.besTotal")}</span>
                <span className="text-white font-semibold tabular-nums">
                  {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(besTotal)} {currency}
                </span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-600 leading-relaxed">{t("assetForm.besNote")}</p>
        </div>
      ) : (
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.estimatedValue")}</label>
          <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="0.00" className={sharedInputClass} />
          {estimateHint && <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.estimateHint")}</p>}
        </div>
      )}
    </div>
  );
}

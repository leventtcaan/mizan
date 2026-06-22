"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  AssetFormProps, buildSourceDetail, GOLD_UNITS, previewLine, sharedInputClass, useUsdRates,
} from "./shared";

export default function GoldAssetForm({ onDraftChange }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, tryPerUsd } = useUsdRates();
  const [unitCode, setUnitCode] = useState(GOLD_UNITS[0].code);
  const [qty, setQty] = useState("");

  const unit = GOLD_UNITS.find((u) => u.code === unitCode) ?? GOLD_UNITS[0];
  const pureOz = (parseFloat(qty || "0") || 0) * unit.xauPerUnit;

  useEffect(() => {
    const n = parseFloat(qty);
    if (!isNaN(n) && n > 0) {
      const unitLabel = t(`assetForm.goldUnits.${unit.labelKey}`);
      onDraftChange({
        name: unitLabel,
        asset_type: "gold",
        currency: "XAU",
        current_value: pureOz.toFixed(6),
        source_detail: buildSourceDetail({
          subtype: "gold", unit: unit.code, label: unit.labelKey,
          quantity: qty, pure_oz: pureOz.toFixed(6),
        }),
      });
    } else {
      onDraftChange(null);
    }
  }, [unitCode, qty]); // eslint-disable-line react-hooks/exhaustive-deps

  const goldUsd = usdPriceOf("XAU"); // USD per troy oz
  const preview = qty ? previewLine((goldUsd ?? 0) * pureOz, tryPerUsd) : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.goldTypeLabel")}</label>
        <select value={unitCode} onChange={(e) => setUnitCode(e.target.value)} className={sharedInputClass}>
          {GOLD_UNITS.map((u) => (
            <option key={u.code} value={u.code}>{t(`assetForm.goldUnits.${u.labelKey}`)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {t("assetForm.goldQty")} <span className="text-gray-600">({t(`assetForm.units.${unit.unitKey}`)})</span>
        </label>
        <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
          placeholder="0" className={sharedInputClass} />
        {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
      </div>

      <p className="text-[11px] text-gray-600 leading-relaxed">{t("assetForm.goldPurityNote")}</p>
    </div>
  );
}

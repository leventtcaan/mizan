"use client";

import { useEffect, useState } from "react";
import { createAsset, updateAsset, AssetItem } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { AssetDraft } from "@/components/asset-forms/shared";
import CryptoAssetForm from "@/components/asset-forms/CryptoAssetForm";
import CurrencyAssetForm from "@/components/asset-forms/CurrencyAssetForm";
import GoldAssetForm from "@/components/asset-forms/GoldAssetForm";
import MarketAssetForm from "@/components/asset-forms/MarketAssetForm";
import ManualAssetForm from "@/components/asset-forms/ManualAssetForm";

const TYPE_GROUPS: { groupKey: string; types: string[] }[] = [
  { groupKey: "cashBank", types: ["cash", "bank_account", "foreign_currency"] },
  { groupKey: "investments", types: ["stock", "fund", "crypto", "gold", "commodity", "bond"] },
  { groupKey: "property", types: ["real_estate", "vehicle"] },
  { groupKey: "retirement", types: ["bes", "pension", "life_insurance"] },
  { groupKey: "other", types: ["business_ownership", "art_collectible", "jewelry", "other_asset"] },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function routeForm(assetType: string, onDraftChange: (d: AssetDraft | null) => void, displayCurrency: string) {
  const p = { assetType, onDraftChange, displayCurrency };
  if (assetType === "crypto") return <CryptoAssetForm {...p} />;
  if (assetType === "gold") return <GoldAssetForm {...p} />;
  if (assetType === "foreign_currency" || assetType === "commodity") return <CurrencyAssetForm {...p} />;
  if (assetType === "stock" || assetType === "fund") return <MarketAssetForm {...p} />;
  return <ManualAssetForm {...p} />;
}

interface Props {
  onClose: () => void;
  onAdded: (asset: AssetItem) => void;
  onUpdated?: (asset: AssetItem) => void;
  displayCurrency: string;
  editData?: AssetItem | null;
  initialType?: string;
}

export default function AddAssetModal({ onClose, onAdded, onUpdated, displayCurrency, editData, initialType }: Props) {
  const { t } = useLanguage();
  const isEdit = !!editData;

  const [assetType, setAssetType] = useState<string | null>(editData?.asset_type ?? initialType ?? null);
  const [draft, setDraft] = useState<AssetDraft | null>(null);
  const [notes, setNotes] = useState(editData?.notes ?? "");
  const [asOfDate, setAsOfDate] = useState(editData?.as_of_date ?? todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When editing, provide a pre-built draft from existing data so form shows values
  useEffect(() => {
    if (editData && !draft) {
      setDraft({
        name: editData.name,
        asset_type: editData.asset_type,
        currency: editData.currency,
        current_value: editData.current_value,
        source_detail: editData.source_detail ?? undefined,
      });
    }
  }, [editData]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeLabel = (k: string) => {
    const key = `assetType.${k}`;
    return t(key) !== key ? t(key) : k;
  };

  function chooseType(next: string) {
    setAssetType(next);
    setDraft(null);
    setError(null);
  }

  function back() {
    if (isEdit) { onClose(); return; }
    setAssetType(null);
    setDraft(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !assetType) return;
    setError(null);
    setLoading(true);
    try {
      if (isEdit && editData) {
        const updated = await updateAsset(editData.id, {
          name: draft.name,
          asset_type: draft.asset_type,
          currency: draft.currency,
          current_value: draft.current_value,
          notes: notes || undefined,
          source_detail: draft.source_detail,
          as_of_date: asOfDate || undefined,
        });
        onUpdated?.(updated);
      } else {
        const asset = await createAsset({
          name: draft.name,
          asset_type: draft.asset_type,
          currency: draft.currency,
          current_value: draft.current_value,
          notes: notes || undefined,
          source: "manual",
          source_detail: draft.source_detail,
          as_of_date: asOfDate || undefined,
        });
        onAdded(asset);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            {assetType && !isEdit && (
              <button onClick={back} className="text-gray-500 hover:text-gray-300 transition-colors" aria-label={t("common.back")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
            <h2 className="text-white font-semibold text-lg">
              {isEdit ? `${t("common.edit")}: ${editData!.name}` : assetType ? typeLabel(assetType) : t("nw.addAsset")}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={20} /></button>
        </div>

        {/* Step 1 — type picker (add mode only) */}
        {!assetType && !isEdit && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">{t("assetForm.pickTypePrompt")}</p>
            {TYPE_GROUPS.map((group) => (
              <div key={group.groupKey}>
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">
                  {t(`assetForm.groups.${group.groupKey}`)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {group.types.map((tp) => (
                    <button key={tp} type="button" onClick={() => chooseType(tp)}
                      className="text-left px-3 py-2.5 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] text-sm text-gray-300 hover:border-indigo-600 hover:text-white transition-colors">
                      {typeLabel(tp)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 2 — per-type form + shared footer */}
        {assetType && (
          <form onSubmit={submit} className="space-y-4">
            {routeForm(assetType, setDraft, displayCurrency)}

            <div className="pt-1 border-t border-[#2A2A2A] space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{t("common.date")}</label>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{t("common.notes")} ({t("common.optional")})</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </div>
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={back} className="flex-1 px-4 py-2 rounded-lg border border-[#2A2A2A] text-sm text-gray-400 hover:text-gray-200 transition-colors">
                {isEdit ? t("common.cancel") : t("common.back")}
              </button>
              <button type="submit" disabled={loading || !draft}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
                {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

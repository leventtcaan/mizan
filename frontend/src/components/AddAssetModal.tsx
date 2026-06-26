"use client";

import { useEffect, useState } from "react";
import { createAsset, updateAsset, getAccounts, createAccount, AssetItem, type Account } from "@/lib/api";
import { X, TrendingUp, ChevronDown } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
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
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  const isEdit = !!editData;

  const [assetType, setAssetType] = useState<string | null>(editData?.asset_type ?? initialType ?? null);
  const [draft, setDraft] = useState<AssetDraft | null>(null);
  const [notes, setNotes] = useState(editData?.notes ?? "");
  const [asOfDate, setAsOfDate] = useState(editData?.as_of_date ?? todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>(editData?.account_id ?? "");
  const [newAccountName, setNewAccountName] = useState("");
  // Account / date / notes are optional — hidden by default so the common path is just
  // name + value. Opened by default when editing (so existing extras are visible).
  const [showDetails, setShowDetails] = useState(isEdit);

  useEffect(() => { getAccounts().then(setAccounts).catch(() => setAccounts([])); }, []);

  // Account linking is only meaningful for cash/bank/FX holdings.
  const accountRelevant = ["cash", "bank_account", "foreign_currency"].includes(assetType ?? "");

  async function ensureAccount(): Promise<string> {
    // Create-on-the-fly when the user typed a new account name.
    if (!accountRelevant) return "";
    if (accountId) return accountId;
    if (newAccountName.trim()) {
      try {
        const acc = await createAccount({ name: newAccountName.trim(), account_type: "bank", currency: draft?.currency || displayCurrency });
        return acc.id;
      } catch { return ""; }
    }
    return "";
  }

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
      const resolvedAccount = await ensureAccount();
      if (isEdit && editData) {
        const updated = await updateAsset(editData.id, {
          name: draft.name,
          asset_type: draft.asset_type,
          currency: draft.currency,
          current_value: draft.current_value,
          notes: notes || undefined,
          source_detail: draft.source_detail,
          as_of_date: asOfDate || undefined,
          quantity: draft.quantity,
          unit_code: draft.unit_code,
          account_id: resolvedAccount || undefined,
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
          quantity: draft.quantity,
          unit_code: draft.unit_code,
          account_id: resolvedAccount || undefined,
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
    "w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="border border-line rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto shadow-2xl shadow-black/30" style={{ backgroundColor: surfaceBg }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            {assetType && !isEdit ? (
              <button onClick={back} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label={t("common.back")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            ) : (
              <span className="w-9 h-9 rounded-xl bg-pos/10 flex items-center justify-center shrink-0"><TrendingUp size={17} className="text-pos" /></span>
            )}
            <h2 className="text-ink font-semibold text-lg truncate">
              {isEdit ? `${t("common.edit")}: ${editData!.name}` : assetType ? typeLabel(assetType) : t("nw.addAsset")}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0"><X size={18} /></button>
        </div>

        {/* Step 1 — type picker (add mode only) */}
        {!assetType && !isEdit && (
          <div className="space-y-4">
            <p className="text-xs text-ink-mute">{t("assetForm.pickTypePrompt")}</p>
            {TYPE_GROUPS.map((group) => (
              <div key={group.groupKey}>
                <p className="text-[10px] font-semibold text-ink-mute uppercase tracking-wider mb-2">
                  {t(`assetForm.groups.${group.groupKey}`)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {group.types.map((tp) => (
                    <button key={tp} type="button" onClick={() => chooseType(tp)}
                      className="text-left px-3 py-2.5 rounded-lg bg-canvas border border-line text-sm text-ink-soft hover:border-[#176B5B] hover:text-[#176B5B] transition-colors">
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

            <div className="pt-1 border-t border-line">
              <button type="button" onClick={() => setShowDetails((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-ink-mute hover:text-ink-soft transition-colors py-1.5">
                <ChevronDown size={14} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} />
                {t("assetForm.moreDetails")}
              </button>
              {showDetails && (
                <div className="space-y-4 pt-2">
                  {accountRelevant && (
                    <div>
                      <label className="block text-xs text-ink-mute mb-1.5">{t("nw.account")} ({t("common.optional")})</label>
                      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                        <option value="">{t("nw.noAccount")}</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.institution ? ` · ${a.institution}` : ""}</option>)}
                      </select>
                      {!accountId && (
                        <input
                          value={newAccountName}
                          onChange={(e) => setNewAccountName(e.target.value)}
                          placeholder={t("nw.newAccountPlaceholder")}
                          className={`${inputClass} mt-2`}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-ink-mute mb-1.5">{t("common.date")}</label>
                    <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-mute mb-1.5">{t("common.notes")} ({t("common.optional")})</label>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-neg text-xs">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={back} className="flex-1 px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-soft hover:bg-surface-2 transition-colors">
                {isEdit ? t("common.cancel") : t("common.back")}
              </button>
              <button type="submit" disabled={loading || !draft}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors">
                {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

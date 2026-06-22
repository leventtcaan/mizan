"use client";

import { useEffect, useMemo, useState } from "react";
import { createAsset, AssetItem, getCurrencyList, type CurrencyEntry, type CurrencyList } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";

const ASSET_TYPE_KEYS = [
  "cash", "bank_account", "stock", "fund", "crypto", "real_estate", "vehicle",
  "bes", "gold", "foreign_currency", "bond", "commodity", "startup_equity",
  "art_collectible", "jewelry", "life_insurance", "pension", "business_ownership", "other_asset",
] as const;

const GOLD_UNITS: { code: string; label: string }[] = [
  { code: "XAU_TROY_OZ", label: "Troy ounce" },
  { code: "GRAM_24K", label: "Gram 24K" },
  { code: "GRAM_22K", label: "Gram 22K" },
  { code: "GRAM_18K", label: "Gram 18K" },
  { code: "KILOGRAM_BAR", label: "Kilogram bar" },
  { code: "SOVEREIGN", label: "Sovereign coin" },
  { code: "AMERICAN_EAGLE", label: "American Eagle coin" },
  { code: "MAPLE_LEAF", label: "Maple Leaf coin" },
  { code: "KRUGERRAND", label: "Krugerrand coin" },
  { code: "QUARTER_COIN", label: "Quarter coin" },
  { code: "HALF_COIN", label: "Half coin" },
  { code: "FULL_COIN", label: "Full coin" },
];

const MANUAL_DETAIL_CONFIG: Record<string, { primary: string; secondary?: string; tertiary?: string; required?: boolean }> = {
  cash: { primary: "Storage location", secondary: "Label", required: true },
  bank_account: { primary: "Institution / Bank", secondary: "Account type", tertiary: "Last 4 digits / label", required: true },
  real_estate: { primary: "Property type", secondary: "Country / city", tertiary: "Address / deed note", required: true },
  vehicle: { primary: "Make", secondary: "Model / year", tertiary: "Plate / VIN / note", required: true },
  bes: { primary: "Provider", secondary: "Plan / contract no.", required: true },
  bond: { primary: "Issuer", secondary: "ISIN / code", tertiary: "Maturity date", required: true },
  startup_equity: { primary: "Company", secondary: "Ownership %", tertiary: "Round / note", required: true },
  art_collectible: { primary: "Item / collection name", secondary: "Artist / maker", tertiary: "Certificate / provenance", required: true },
  jewelry: { primary: "Piece type", secondary: "Metal / stone", tertiary: "Purity / certificate", required: true },
  life_insurance: { primary: "Insurance company", secondary: "Policy no.", tertiary: "Beneficiary / note", required: true },
  pension: { primary: "Provider", secondary: "Plan / account no.", required: true },
  business_ownership: { primary: "Business name", secondary: "Ownership %", tertiary: "Country / sector", required: true },
  other_asset: { primary: "Description", secondary: "Reference / note", required: false },
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function filterEntries(entries: CurrencyEntry[], query: string): CurrencyEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, 12);
  return entries
    .filter((entry) => entry.code.toLowerCase().includes(q) || entry.name.toLowerCase().includes(q))
    .slice(0, 20);
}

function stringifySourceDetail(detail: Record<string, string>): string {
  const cleaned = Object.fromEntries(Object.entries(detail).filter(([, v]) => v.trim().length > 0));
  return JSON.stringify(cleaned);
}

interface Props {
  onClose: () => void;
  onAdded: (asset: AssetItem) => void;
}

export default function AddAssetModal({ onClose, onAdded }: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("bank_account");
  const [currency, setCurrency] = useState("TRY");
  const [currencyList, setCurrencyList] = useState<CurrencyList | null>(null);
  const [subtypeQuery, setSubtypeQuery] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyEntry | null>(null);
  const [selectedFiat, setSelectedFiat] = useState<CurrencyEntry | null>(null);
  const [selectedCommodity, setSelectedCommodity] = useState<CurrencyEntry | null>(null);
  const [goldUnit, setGoldUnit] = useState(GOLD_UNITS[0].code);
  const [marketSymbol, setMarketSymbol] = useState("");
  const [marketName, setMarketName] = useState("");
  const [marketVenue, setMarketVenue] = useState("");
  const [manualPrimary, setManualPrimary] = useState("");
  const [manualSecondary, setManualSecondary] = useState("");
  const [manualTertiary, setManualTertiary] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrencyList().then(setCurrencyList).catch(() => setCurrencyList(null));
  }, []);

  const cryptoMatches = useMemo(() => filterEntries(currencyList?.crypto ?? [], subtypeQuery), [currencyList, subtypeQuery]);
  const fiatMatches = useMemo(() => filterEntries(currencyList?.fiat ?? [], subtypeQuery), [currencyList, subtypeQuery]);
  const commodityMatches = useMemo(() => filterEntries(currencyList?.commodities ?? [], subtypeQuery), [currencyList, subtypeQuery]);

  function resetSubtypeState(nextType: string) {
    setAssetType(nextType);
    setSubtypeQuery("");
    setSelectedCrypto(null);
    setSelectedFiat(null);
    setSelectedCommodity(null);
    setGoldUnit(GOLD_UNITS[0].code);
    setMarketSymbol(""); setMarketName(""); setMarketVenue("");
    setManualPrimary(""); setManualSecondary(""); setManualTertiary("");
  }

  function setNameIfEmpty(nextName: string) {
    setName((current) => (current.trim() ? current : nextName));
  }

  function buildSourceDetail(): string | undefined {
    if (assetType === "crypto" && selectedCrypto) return stringifySourceDetail({ subtype: "crypto", symbol: selectedCrypto.code, name: selectedCrypto.name });
    if (assetType === "foreign_currency" && selectedFiat) return stringifySourceDetail({ subtype: "foreign_currency", code: selectedFiat.code, name: selectedFiat.name });
    if (assetType === "commodity" && selectedCommodity) return stringifySourceDetail({ subtype: "commodity", code: selectedCommodity.code, name: selectedCommodity.name });
    if (assetType === "gold") { const unit = GOLD_UNITS.find((item) => item.code === goldUnit); return stringifySourceDetail({ subtype: "gold", unit: goldUnit, label: unit?.label ?? goldUnit }); }
    if (assetType === "stock" && marketSymbol.trim()) return stringifySourceDetail({ subtype: "stock", symbol: marketSymbol.trim().toUpperCase(), name: marketName.trim(), venue: marketVenue.trim() });
    if (assetType === "fund" && marketSymbol.trim()) return stringifySourceDetail({ subtype: "fund", code: marketSymbol.trim().toUpperCase(), name: marketName.trim(), venue: marketVenue.trim() });
    const config = MANUAL_DETAIL_CONFIG[assetType];
    if (config) return stringifySourceDetail({ subtype: assetType, primary: manualPrimary.trim(), secondary: manualSecondary.trim(), tertiary: manualTertiary.trim() });
    return undefined;
  }

  const manualConfig = MANUAL_DETAIL_CONFIG[assetType];
  const usesQuantityInput = ["crypto", "foreign_currency", "commodity", "gold"].includes(assetType);
  const subtypeRequiredMissing =
    (assetType === "crypto" && !selectedCrypto) ||
    (assetType === "foreign_currency" && !selectedFiat) ||
    (assetType === "commodity" && !selectedCommodity) ||
    ((assetType === "stock" || assetType === "fund") && !marketSymbol.trim()) ||
    Boolean(manualConfig?.required && !manualPrimary.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const asset = await createAsset({ name, asset_type: assetType, currency, current_value: value, notes: notes || undefined, source: "manual", source_detail: buildSourceDetail(), as_of_date: asOfDate || undefined });
      onAdded(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">{t("nw.addAsset")}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.type")}</label>
            <select value={assetType} onChange={(e) => resetSubtypeState(e.target.value)} className={inputClass}>
              {ASSET_TYPE_KEYS.map((k) => {
                const key = `assetType.${k}`;
                const label = t(key) !== key ? t(key) : k;
                return <option key={k} value={k}>{label}</option>;
              })}
            </select>
          </div>

          {assetType === "crypto" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("assetType.crypto")}</label>
              <input value={subtypeQuery} onChange={(e) => { setSubtypeQuery(e.target.value); setSelectedCrypto(null); }} placeholder="Bitcoin, ETH, SOL..." className={inputClass} />
              <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-[#2A2A2A]">
                {cryptoMatches.map((entry) => (
                  <button key={`${entry.code}-${entry.name}`} type="button"
                    onClick={() => { setSelectedCrypto(entry); setCurrency(entry.code); setSubtypeQuery(`${entry.code} — ${entry.name}`); setNameIfEmpty(entry.name); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#111] ${selectedCrypto?.code === entry.code ? "bg-indigo-950/40 text-indigo-300" : "text-gray-300"}`}>
                    <span className="font-semibold">{entry.code}</span>
                    <span className="text-gray-500 truncate ml-3">{entry.name}</span>
                  </button>
                ))}
                {cryptoMatches.length === 0 && <p className="px-3 py-3 text-xs text-gray-600">{t("common.notFound")}</p>}
              </div>
            </div>
          )}

          {assetType === "foreign_currency" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("assetType.foreign_currency")}</label>
              <input value={subtypeQuery} onChange={(e) => { setSubtypeQuery(e.target.value); setSelectedFiat(null); }} placeholder="USD, EUR, GBP..." className={inputClass} />
              <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-[#2A2A2A]">
                {fiatMatches.map((entry) => (
                  <button key={entry.code} type="button"
                    onClick={() => { setSelectedFiat(entry); setCurrency(entry.code); setSubtypeQuery(`${entry.code} — ${entry.name}`); setNameIfEmpty(entry.name); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#111] ${selectedFiat?.code === entry.code ? "bg-indigo-950/40 text-indigo-300" : "text-gray-300"}`}>
                    <span className="font-semibold">{entry.code}</span>
                    <span className="text-gray-500 truncate ml-3">{entry.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {assetType === "commodity" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("assetType.commodity")}</label>
              <input value={subtypeQuery} onChange={(e) => { setSubtypeQuery(e.target.value); setSelectedCommodity(null); }} placeholder="Gold, silver, brent..." className={inputClass} />
              <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-[#2A2A2A]">
                {commodityMatches.map((entry) => (
                  <button key={entry.code} type="button"
                    onClick={() => { setSelectedCommodity(entry); setCurrency(entry.code); setSubtypeQuery(`${entry.code} — ${entry.name}`); setNameIfEmpty(entry.name); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#111] ${selectedCommodity?.code === entry.code ? "bg-indigo-950/40 text-indigo-300" : "text-gray-300"}`}>
                    <span className="font-semibold">{entry.code}</span>
                    <span className="text-gray-500 truncate ml-3">{entry.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {assetType === "gold" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("assetType.gold")}</label>
              <select value={goldUnit} onChange={(e) => { setGoldUnit(e.target.value); const unit = GOLD_UNITS.find((item) => item.code === e.target.value); if (unit) setNameIfEmpty(unit.label); }} className={inputClass}>
                {GOLD_UNITS.map((unit) => <option key={unit.code} value={unit.code}>{unit.label}</option>)}
              </select>
            </div>
          )}

          {(assetType === "stock" || assetType === "fund") && (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{assetType === "stock" ? "Ticker / Symbol" : "ISIN / Fund Code"}</label>
                <input value={marketSymbol} onChange={(e) => { setMarketSymbol(e.target.value); setNameIfEmpty(e.target.value.toUpperCase()); }} required className={inputClass + " uppercase"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input value={marketName} onChange={(e) => setMarketName(e.target.value)} placeholder={t("common.name") + " (" + t("common.optional") + ")"} className={inputClass} />
                <input value={marketVenue} onChange={(e) => setMarketVenue(e.target.value)} placeholder="Exchange / provider" className={inputClass} />
              </div>
            </div>
          )}

          {manualConfig && (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{manualConfig.primary}</label>
                <input value={manualPrimary} onChange={(e) => { setManualPrimary(e.target.value); setNameIfEmpty(e.target.value); }} required={manualConfig.required} placeholder={manualConfig.primary} className={inputClass} />
              </div>
              {(manualConfig.secondary || manualConfig.tertiary) && (
                <div className="grid grid-cols-2 gap-3">
                  {manualConfig.secondary && <input value={manualSecondary} onChange={(e) => setManualSecondary(e.target.value)} placeholder={manualConfig.secondary + " (" + t("common.optional") + ")"} className={inputClass} />}
                  {manualConfig.tertiary && <input value={manualTertiary} onChange={(e) => setManualTertiary(e.target.value)} placeholder={manualConfig.tertiary + " (" + t("common.optional") + ")"} className={inputClass} />}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.currency")}</label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{usesQuantityInput ? "Qty / Amount" : t("common.amount")}</label>
            <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" required className={inputClass} />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.date")}</label>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.notes")} ({t("common.optional")})</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-[#2A2A2A] text-sm text-gray-400 hover:text-gray-200 transition-colors">{t("common.cancel")}</button>
            <button type="submit" disabled={loading || !name || !value || subtypeRequiredMissing} className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
              {loading ? t("common.loading") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

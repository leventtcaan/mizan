"use client";

import { useState } from "react";
import { createAsset, AssetItem } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";

const ASSET_TYPES: { value: string; label: string }[] = [
  { value: "cash", label: "Nakit" },
  { value: "bank_account", label: "Banka Hesabı" },
  { value: "stock", label: "Hisse Senedi" },
  { value: "fund", label: "Yatırım Fonu" },
  { value: "crypto", label: "Kripto Para" },
  { value: "real_estate", label: "Gayrimenkul" },
  { value: "vehicle", label: "Araç" },
  { value: "bes", label: "BES / Emeklilik" },
  { value: "gold", label: "Altın" },
  { value: "foreign_currency", label: "Döviz" },
  { value: "bond", label: "Tahvil / Bono" },
  { value: "commodity", label: "Emtia" },
  { value: "startup_equity", label: "Startup Hissesi" },
  { value: "art_collectible", label: "Sanat / Koleksiyon" },
  { value: "jewelry", label: "Mücevher" },
  { value: "life_insurance", label: "Hayat Sigortası" },
  { value: "pension", label: "Emeklilik Fonu" },
  { value: "business_ownership", label: "İşletme Ortaklığı" },
  { value: "other_asset", label: "Diğer" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Props {
  onClose: () => void;
  onAdded: (asset: AssetItem) => void;
}

export default function AddAssetModal({ onClose, onAdded }: Props) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("bank_account");
  const [currency, setCurrency] = useState("TRY");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const asset = await createAsset({
        name,
        asset_type: assetType,
        currency,
        current_value: value,
        notes: notes || undefined,
        source: "manual",
        as_of_date: asOfDate || undefined,
      });
      onAdded(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Varlık Ekle</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Ad</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn. Garanti vadesiz hesabı"
              required
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Tür</label>
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600"
            >
              {ASSET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Para Birimi</label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Güncel Değer</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.00"
              required
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Değerleme Tarihi</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Not (opsiyonel)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ör. IBAN, kurum adı..."
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-[#2A2A2A] text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={loading || !name || !value}
              className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
            >
              {loading ? "Ekleniyor..." : "Ekle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

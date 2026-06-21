"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import AddAssetModal from "@/components/AddAssetModal";
import AddLiabilityModal from "@/components/AddLiabilityModal";
import AddReceivableModal from "@/components/AddReceivableModal";
import CurrencySelect from "@/components/CurrencySelect";
import {
  getToken,
  getNetWorthSummary,
  getAssets,
  getLiabilities,
  getReceivables,
  deleteAsset,
  deleteLiability,
  deleteReceivable,
  updateReceivableStatus,
  getNetWorthSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  getFinancialEvents,
  getReconciliationItems,
  scanReconciliation,
  updateReconciliationItemStatus,
  deleteBatch,
  AssetItem,
  LiabilityItem,
  ReceivableItem,
  NetWorthSummary,
  SuggestionItem,
  FinancialEventItem,
  ReconciliationItem,
} from "@/lib/api";
import { Plus, TrendingUp, TrendingDown, DollarSign, Home, Wallet, Briefcase, Scale, Brain, Zap } from "@/components/ui/Icons";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuel giriş",
  statement_upload: "Ekstre",
  receivable_collection: "Alacak tahsilatı",
  auto_detected: "Otomatik",
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  cash: "Nakit",
  bank_account: "Banka Hesabı",
  stock: "Hisse Senedi",
  fund: "Yatırım Fonu",
  crypto: "Kripto Para",
  real_estate: "Gayrimenkul",
  vehicle: "Araç",
  bes: "BES / Emeklilik",
  gold: "Altın",
  foreign_currency: "Döviz",
  bond: "Tahvil / Bono",
  commodity: "Emtia",
  startup_equity: "Startup Hissesi",
  art_collectible: "Sanat / Koleksiyon",
  jewelry: "Mücevher",
  life_insurance: "Hayat Sigortası",
  pension: "Emeklilik Fonu",
  business_ownership: "İşletme Ortaklığı",
  other_asset: "Diğer",
};

const LIABILITY_TYPE_LABELS: Record<string, string> = {
  mortgage: "Konut Kredisi",
  auto_loan: "Taşıt Kredisi",
  personal_loan: "İhtiyaç Kredisi",
  credit_card: "Kredi Kartı",
  student_loan: "Eğitim Kredisi",
  family_debt: "Aile / Arkadaş",
  other_liability: "Diğer",
};

const ASSET_TYPE_GROUPS: { label: string; icon: ReactNode; types: string[] }[] = [
  {
    label: "Nakit & Banka",
    icon: <Wallet size={16} className="text-emerald-400" />,
    types: ["cash", "bank_account", "foreign_currency"],
  },
  {
    label: "Yatırımlar",
    icon: <TrendingUp size={16} className="text-indigo-400" />,
    types: ["stock", "fund", "crypto", "bes", "gold", "bond", "commodity", "startup_equity"],
  },
  {
    label: "Gayrimenkul & Araç",
    icon: <Home size={16} className="text-amber-400" />,
    types: ["real_estate", "vehicle"],
  },
  {
    label: "Kişisel Varlıklar",
    icon: <Briefcase size={16} className="text-purple-400" />,
    types: ["art_collectible", "jewelry", "life_insurance", "pension", "business_ownership"],
  },
  {
    label: "Diğer",
    icon: <Briefcase size={16} className="text-gray-400" />,
    types: ["other_asset"],
  },
];

function fmt(value: number, currency = "TRY"): string {
  try {
    if (currency === "TRY") {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 0,
      }).format(value);
    }
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 8 }).format(value)} ${currency}`;
  }
}

function fmtItem(value: string, currency: string): string {
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  return fmt(n, currency);
}

function sourceDetailLabel(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      subtype?: string;
      symbol?: string;
      code?: string;
      unit?: string;
      label?: string;
      name?: string;
      venue?: string;
      primary?: string;
      secondary?: string;
      tertiary?: string;
    };
    if (data.subtype === "crypto" && data.symbol) {
      return [data.symbol, data.name].filter(Boolean).join(" · ");
    }
    if (data.subtype === "foreign_currency" && data.code) {
      return [data.code, data.name].filter(Boolean).join(" · ");
    }
    if (data.subtype === "commodity" && data.code) {
      return [data.code, data.name].filter(Boolean).join(" · ");
    }
    if (data.subtype === "gold") {
      return data.label ?? data.unit ?? null;
    }
    if (data.subtype === "stock" && data.symbol) {
      return [data.symbol, data.name, data.venue].filter(Boolean).join(" · ");
    }
    if (data.subtype === "fund" && data.code) {
      return [data.code, data.name, data.venue].filter(Boolean).join(" · ");
    }
    if (data.primary || data.secondary || data.tertiary) {
      return [data.primary, data.secondary, data.tertiary].filter(Boolean).join(" · ");
    }
  } catch {
    return raw;
  }
  return raw;
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    receivable_collected: "Receivable collected",
    receivable_collection_reversed: "Collection reversed",
    receivable_written_off: "Receivable written off",
    asset_created: "Asset created",
    asset_updated: "Asset updated",
    liability_created: "Liability created",
    statement_uploaded: "Statement uploaded",
  };
  return labels[eventType] ?? eventType.replaceAll("_", " ");
}

function eventDetail(detail: FinancialEventItem["source_detail"]): string | null {
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  const parts = [
    typeof detail.from_person === "string" ? detail.from_person : null,
    typeof detail.asset_id === "string" ? `asset ${detail.asset_id.slice(0, 8)}` : null,
    typeof detail.removed_asset_id === "string" ? `removed asset ${detail.removed_asset_id.slice(0, 8)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

async function loadOpenReconciliationItems(): Promise<ReconciliationItem[]> {
  await scanReconciliation().catch(() => null);
  return getReconciliationItems("open").catch(() => [] as ReconciliationItem[]);
}

function SectionHeader({
  label,
  icon,
  total,
  displayCurrency,
  onAdd,
  addLabel,
  addColor = "indigo",
  badge,
}: {
  label: string;
  icon: ReactNode;
  total?: number;
  displayCurrency: string;
  onAdd: () => void;
  addLabel: string;
  addColor?: string;
  badge?: ReactNode;
}) {
  const btnColors: Record<string, string> = {
    indigo: "bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border-indigo-800/40",
    red: "bg-red-600/20 text-red-400 hover:bg-red-600/30 border-red-800/40",
    amber: "bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border-amber-800/40",
  };
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-white font-semibold">{label}</h2>
        {badge}
        {total !== undefined && (
          <span className="text-sm text-gray-400">{fmt(total, displayCurrency)}</span>
        )}
      </div>
      <button
        onClick={onAdd}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${btnColors[addColor] ?? btnColors.indigo}`}
      >
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  );
}

// Toast component
function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-emerald-700 text-white rounded-lg px-4 py-3 shadow-lg text-sm max-w-xs">
      {message}
    </div>
  );
}

export default function NetWorthPage() {
  const router = useRouter();
  const [displayCurrency, setDisplayCurrency] = useState("TRY");

  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [liabilities, setLiabilities] = useState<LiabilityItem[]>([]);
  const [receivables, setReceivables] = useState<ReceivableItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [events, setEvents] = useState<FinancialEventItem[]>([]);
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const [showAddAsset, setShowAddAsset] = useState(false);
  const [showAddLiability, setShowAddLiability] = useState(false);
  const [showAddReceivable, setShowAddReceivable] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, a, l, r, sugg, eventRows, itemRows] = await Promise.all([
        getNetWorthSummary(displayCurrency),
        getAssets(),
        getLiabilities(),
        getReceivables(),
        getNetWorthSuggestions().catch(() => [] as SuggestionItem[]),
        getFinancialEvents(8).catch(() => [] as FinancialEventItem[]),
        loadOpenReconciliationItems(),
      ]);
      setSummary(s);
      setAssets(a);
      setLiabilities(l);
      setReceivables(r);
      setSuggestions(sugg);
      setEvents(eventRows);
      setReconciliationItems(itemRows);
    } catch {
      // silent — empty state shows
    } finally {
      setLoading(false);
    }
  };

  const reloadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const s = await getNetWorthSummary(displayCurrency);
      setSummary(s);
    } finally {
      setSummaryLoading(false);
    }
  }, [displayCurrency]);

  const reloadReconciliation = useCallback(async () => {
    const [eventRows, itemRows] = await Promise.all([
      getFinancialEvents(8).catch(() => [] as FinancialEventItem[]),
      loadOpenReconciliationItems(),
    ]);
    setEvents(eventRows);
    setReconciliationItems(itemRows);
  }, []);

  useEffect(() => {
    if (!loading) reloadSummary();
  }, [displayCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteAsset = async (id: string) => {
    await deleteAsset(id);
    setAssets((prev) => prev.filter((a) => a.id !== id));
    void reloadSummary();
  };

  const handleDeleteLiability = async (id: string) => {
    await deleteLiability(id);
    setLiabilities((prev) => prev.filter((l) => l.id !== id));
    void reloadSummary();
  };

  const handleDeleteReceivable = async (id: string) => {
    const receivable = receivables.find((r) => r.id === id);
    const removesLinkedAsset = receivable?.status === "received" && receivable.linked_asset_id;
    if (removesLinkedAsset) {
      const ok = window.confirm(
        "This receivable was already collected. Deleting it will also remove the cash asset created from it.",
      );
      if (!ok) return;
    }
    await deleteReceivable(id);
    setReceivables((prev) => prev.filter((r) => r.id !== id));
    if (receivable?.linked_asset_id) {
      setAssets((prev) => prev.filter((a) => a.id !== receivable.linked_asset_id));
    }
    void reloadSummary();
    void reloadReconciliation();
  };

  const handleMarkReceived = async (id: string) => {
    const result = await updateReceivableStatus(id, "received");
    setReceivables((prev) => prev.map((r) => (r.id === id ? result.receivable : r)));
    if (result.created_asset) {
      setAssets((prev) => [...prev, result.created_asset!]);
    }
    if (result.toast_message) {
      setToast(result.toast_message);
    }
    void reloadSummary();
    void reloadReconciliation();
  };

  const handleAcceptSuggestion = async (id: string) => {
    await acceptSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    void reloadSummary();
    void loadAll(); // also reload assets
  };

  const handleDismissSuggestion = async (id: string) => {
    await dismissSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleReconciliationStatus = async (
    id: string,
    status: "resolved" | "dismissed",
  ) => {
    const updated = await updateReconciliationItemStatus(id, status);
    setReconciliationItems((prev) => prev.filter((item) => item.id !== updated.id));
    setToast(status === "resolved" ? "Review item resolved." : "Review item dismissed.");
  };

  const handleReconciliationAction = async (item: ReconciliationItem, action: string) => {
    const key = `${item.id}:${action}`;
    if (actionPending === key) return;
    setActionPending(key);
    try {
      const pa = (typeof item.proposed_action === "object" && item.proposed_action !== null)
        ? item.proposed_action as Record<string, unknown>
        : null;
      const entityId = item.related_entity_id;

      if (item.issue_type === "overdue_receivable" && entityId) {
        if (action === "mark_received") {
          const result = await updateReceivableStatus(entityId, "received");
          setReceivables((prev) => prev.map((r) => r.id === entityId ? result.receivable : r));
          if (result.created_asset) setAssets((prev) => [...prev, result.created_asset!]);
          setToast(result.toast_message ?? "Receivable marked received.");
        } else if (action === "write_off") {
          await updateReceivableStatus(entityId, "written_off");
          setReceivables((prev) => prev.filter((r) => r.id !== entityId));
          setToast("Receivable written off.");
        }
        await updateReconciliationItemStatus(item.id, "resolved");
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        void reloadSummary();
        return;
      }

      if (item.issue_type === "received_receivable_missing_asset" && entityId) {
        if (action === "create_cash_asset") {
          const result = await updateReceivableStatus(entityId, "received");
          setReceivables((prev) => prev.map((r) => r.id === entityId ? result.receivable : r));
          if (result.created_asset) setAssets((prev) => [...prev, result.created_asset!]);
          setToast(result.toast_message ?? "Cash asset created.");
        } else if (action === "mark_pending") {
          const result = await updateReceivableStatus(entityId, "pending");
          setReceivables((prev) => prev.map((r) => r.id === entityId ? result.receivable : r));
          setToast("Receivable set back to pending.");
        } else if (action === "write_off") {
          await updateReceivableStatus(entityId, "written_off");
          setReceivables((prev) => prev.filter((r) => r.id !== entityId));
          setToast("Receivable written off.");
        }
        await updateReconciliationItemStatus(item.id, "resolved");
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        void reloadSummary();
        return;
      }

      if (item.issue_type === "possible_duplicate_transaction") {
        if (action === "delete_duplicate_batch" && pa?.upload_batch_ids) {
          const batchIds = pa.upload_batch_ids as string[];
          if (batchIds.length < 2) {
            setToast("Only one batch — nothing to delete.");
          } else {
            const ok = window.confirm(
              `Delete ${batchIds.length - 1} older duplicate batch(es)? This will remove those transactions permanently.`
            );
            if (!ok) { setActionPending(null); return; }
            for (const batchId of batchIds.slice(0, -1)) {
              await deleteBatch(batchId).catch(() => null);
            }
            setToast(`Removed ${batchIds.length - 1} duplicate batch(es).`);
          }
        }
        await updateReconciliationItemStatus(item.id, "resolved");
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        return;
      }

      if (item.issue_type === "large_transaction_review") {
        const finalStatus = action === "ignore" ? "dismissed" : "resolved";
        await updateReconciliationItemStatus(item.id, finalStatus);
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        setToast(finalStatus === "resolved" ? "Transaction reviewed." : "Review dismissed.");
        return;
      }

      // fallback: plain status update
      const finalStatus = action === "dismiss" ? "dismissed" : "resolved";
      await updateReconciliationItemStatus(item.id, finalStatus);
      setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      setToast("Action failed — please try again.");
    } finally {
      setActionPending(null);
    }
  };

  const netPositive = (summary?.net_worth_try ?? 0) >= 0;
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  return (
    <PageLayout
      title="Net Değer"
      subtitle="Varlıklar, borçlar ve alacaklar — tüm tablonuz"
      maxWidth="lg"
      action={
        <div className="w-60">
          <CurrencySelect value={displayCurrency} onChange={setDisplayCurrency} />
        </div>
      }
    >
      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* Hero — Net Worth */}
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 mb-6 text-center">
        {loading ? (
          <div className="space-y-3">
            <div className="h-12 w-64 bg-[#2A2A2A] rounded-lg mx-auto animate-pulse" />
            <div className="h-5 w-48 bg-[#2A2A2A] rounded mx-auto animate-pulse" />
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-sm mb-2">Net Değeriniz</p>
            <p
              className={`text-5xl font-bold tabular-nums mb-4 ${
                netPositive ? "text-emerald-400" : "text-red-400"
              } ${summaryLoading ? "opacity-50" : ""}`}
            >
              {summary ? fmt(summary.net_worth_try, displayCurrency) : "—"}
            </p>
            <div className="flex items-center justify-center gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={14} className="text-emerald-400" />
                <span className="text-gray-400">Varlıklar</span>
                <span className="text-emerald-400 font-medium">
                  {summary ? fmt(summary.total_assets_try, displayCurrency) : "—"}
                </span>
              </div>
              <span className="text-gray-700">—</span>
              <div className="flex items-center gap-1.5">
                <TrendingDown size={14} className="text-red-400" />
                <span className="text-gray-400">Borçlar</span>
                <span className="text-red-400 font-medium">
                  {summary ? fmt(summary.total_liabilities_try, displayCurrency) : "—"}
                </span>
              </div>
              {summary && summary.pending_receivables_try > 0 && (
                <>
                  <span className="text-gray-700">+</span>
                  <div className="flex items-center gap-1.5">
                    <DollarSign size={14} className="text-amber-400" />
                    <span className="text-gray-400">Alacaklar</span>
                    <span className="text-amber-400 font-medium">
                      {fmt(summary.pending_receivables_try, displayCurrency)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Currency breakdown */}
            {summary && Object.keys(summary.currency_breakdown).length > 1 && (
              <div className="mt-5 pt-5 border-t border-[#2A2A2A] flex flex-wrap gap-3 justify-center">
                {Object.entries(summary.currency_breakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cur, val]) => (
                    <span
                      key={cur}
                      className="px-2.5 py-1 rounded-full bg-[#2A2A2A] text-xs text-gray-400"
                    >
                      {cur}: {fmt(val, "TRY")}
                    </span>
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* AI Insight */}
      {summary?.ai_insight && (
        <div className="mb-4 bg-[#1A1A1A] border border-indigo-900/30 rounded-xl p-4 flex gap-3">
          <Brain size={16} className="text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-gray-300 text-sm leading-relaxed">{summary.ai_insight}</p>
        </div>
      )}

      {/* Warnings */}
      {summary && summary.warnings.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {summary.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-xl px-4 py-3"
            >
              <span className="text-amber-400 text-sm shrink-0">⚠</span>
              <p className="text-amber-200 text-sm">{w}</p>
            </div>
          ))}
        </div>
      )}

      {(reconciliationItems.length > 0 || events.length > 0) && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-cyan-400" />
            <h2 className="text-white font-semibold">Action Queue</h2>
            {reconciliationItems.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-cyan-950/50 border border-cyan-800/40 text-cyan-300 text-xs font-medium">
                {reconciliationItems.length} open
              </span>
            )}
          </div>

          {reconciliationItems.length > 0 && (
            <div className="space-y-3 mb-3">
              {reconciliationItems.map((item) => {
                const pa = (typeof item.proposed_action === "object" && item.proposed_action !== null)
                  ? item.proposed_action as Record<string, unknown>
                  : null;
                const isPending = (action: string) => actionPending === `${item.id}:${action}`;
                const btn = (action: string, label: string, cls: string) => (
                  <button
                    key={action}
                    disabled={actionPending !== null}
                    onClick={() => handleReconciliationAction(item, action)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${cls}`}
                  >
                    {isPending(action) ? "…" : label}
                  </button>
                );

                let actionButtons: ReactNode;
                if (item.issue_type === "overdue_receivable") {
                  actionButtons = (
                    <>
                      {btn("mark_received", "Mark Received", "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                      {btn("write_off", "Write Off", "bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20")}
                      {btn("dismiss", "Dismiss", "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                    </>
                  );
                } else if (item.issue_type === "received_receivable_missing_asset") {
                  actionButtons = (
                    <>
                      {btn("create_cash_asset", "Re-create Asset", "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                      {btn("mark_pending", "Mark Pending", "bg-amber-600/10 text-amber-400 border border-amber-800/30 hover:bg-amber-600/20")}
                      {btn("write_off", "Write Off", "bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20")}
                    </>
                  );
                } else if (item.issue_type === "possible_duplicate_transaction") {
                  const batchIds = (pa?.upload_batch_ids as string[] | undefined) ?? [];
                  actionButtons = (
                    <>
                      {batchIds.length >= 2 && btn("delete_duplicate_batch", "Delete Older Duplicate", "bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20")}
                      {btn("keep_all", "Keep All", "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                      {btn("dismiss", "Dismiss", "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                    </>
                  );
                } else if (item.issue_type === "large_transaction_review") {
                  actionButtons = (
                    <>
                      {btn("confirm_category", "Confirm & Close", "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                      {btn("ignore", "Ignore", "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                    </>
                  );
                } else {
                  actionButtons = (
                    <>
                      {btn("resolve", "Resolve", "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                      {btn("dismiss", "Dismiss", "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                    </>
                  );
                }

                return (
                  <div
                    key={item.id}
                    className="bg-[#1A1A1A] border border-cyan-900/30 rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-gray-100 text-sm font-medium">{item.title}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            item.severity === "high"
                              ? "bg-red-950/50 text-red-400 border border-red-800/30"
                              : item.severity === "medium"
                              ? "bg-amber-950/50 text-amber-400 border border-amber-800/30"
                              : "bg-[#2A2A2A] text-gray-400"
                          }`}>
                            {item.severity}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs leading-relaxed mt-1">{item.description}</p>
                        {item.issue_type === "possible_duplicate_transaction" && !!pa?.description && (
                          <p className="text-cyan-300/70 text-xs mt-1 truncate">"{String(pa.description)}"</p>
                        )}
                        {item.issue_type === "large_transaction_review" && !!pa?.amount && (
                          <p className="text-cyan-300/70 text-xs mt-1">
                            {String(pa.transaction_type) === "debit" ? "−" : "+"}{String(pa.amount)}
                            {pa.description ? ` · "${String(pa.description).slice(0, 40)}"` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap mt-3">
                      {actionButtons}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {events.length > 0 && (
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#2A2A2A] bg-[#111]">
                <span className="text-xs text-gray-400 font-medium">Recent Events</span>
              </div>
              {events.map((event, idx) => {
                const detail = eventDetail(event.source_detail);
                return (
                  <div
                    key={event.id}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${
                      idx < events.length - 1 ? "border-b border-[#2A2A2A]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-gray-200 text-sm">{eventLabel(event.event_type)}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {event.event_date} · {event.entity_type}
                        {detail ? ` · ${detail}` : ""}
                      </p>
                    </div>
                    {event.amount && event.currency && (
                      <p className="text-gray-300 text-sm font-semibold tabular-nums shrink-0">
                        {fmtItem(event.amount, event.currency)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* VARLIKLAR */}
      <section className="mb-8">
        <SectionHeader
          label="Varlıklar"
          icon={<TrendingUp size={18} className="text-emerald-400" />}
          total={summary?.total_assets_try}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddAsset(true)}
          addLabel="Varlık Ekle"
          addColor="indigo"
        />

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">Henüz varlık eklenmedi</p>
            <button
              onClick={() => setShowAddAsset(true)}
              className="mt-3 text-indigo-400 text-sm hover:text-indigo-300 transition-colors"
            >
              + İlk varlığını ekle
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {ASSET_TYPE_GROUPS.map((group) => {
              const groupAssets = assets.filter((a) => group.types.includes(a.asset_type));
              if (groupAssets.length === 0) return null;
              return (
                <div key={group.label} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2A2A2A] bg-[#111]">
                    {group.icon}
                    <span className="text-xs text-gray-400 font-medium">{group.label}</span>
                  </div>
                  {groupAssets.map((a, idx) => {
                    const detailLabel = sourceDetailLabel(a.source_detail);
                    return (
                      <div
                        key={a.id}
                        className={`flex items-center justify-between px-4 py-3 ${
                          idx < groupAssets.length - 1 ? "border-b border-[#2A2A2A]" : ""
                        }`}
                      >
                        <div>
                          <p className="text-white text-sm font-medium">{a.name}</p>
                          <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}</span>
                            {detailLabel && (
                              <span className="text-gray-400">· {detailLabel}</span>
                            )}
                            {a.notes && <span>· {a.notes}</span>}
                            <span className="text-gray-600">· {SOURCE_LABELS[a.source] ?? a.source}</span>
                            {a.as_of_date && (
                              <span className="text-gray-600">· {a.as_of_date}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-emerald-400 text-sm font-semibold tabular-nums">
                              {fmtItem(a.current_value, a.currency)}
                            </p>
                            {a.currency !== "TRY" && (
                              <p className="text-gray-600 text-xs">{a.currency}</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteAsset(a.id)}
                            className="text-gray-700 hover:text-red-400 transition-colors text-xs px-2"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* BORÇLAR */}
      <section className="mb-8">
        <SectionHeader
          label="Borçlar"
          icon={<TrendingDown size={18} className="text-red-400" />}
          total={summary?.total_liabilities_try}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddLiability(true)}
          addLabel="Borç Ekle"
          addColor="red"
        />

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : liabilities.length === 0 ? (
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">Borç kaydı yok</p>
            <button
              onClick={() => setShowAddLiability(true)}
              className="mt-3 text-red-400 text-sm hover:text-red-300 transition-colors"
            >
              + Borç ekle
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {liabilities.map((l) => {
              const total = parseFloat(l.total_amount);
              const remaining = parseFloat(l.remaining_amount);
              const pct = total > 0 ? Math.min(100, ((total - remaining) / total) * 100) : 0;
              const highInterest = l.interest_rate && parseFloat(l.interest_rate) > 30;

              return (
                <div key={l.id} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-sm font-medium">{l.name}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#2A2A2A] text-gray-400">
                          {LIABILITY_TYPE_LABELS[l.liability_type] ?? l.liability_type}
                        </span>
                        {highInterest && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-800/40">
                            %{l.interest_rate} faiz
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>Kalan: <span className="text-red-400 font-medium">{fmtItem(l.remaining_amount, l.currency)}</span></span>
                        {l.monthly_payment && (
                          <span>Aylık: {fmtItem(l.monthly_payment, l.currency)}</span>
                        )}
                        {l.due_date && <span>Bitiş: {l.due_date}</span>}
                      </div>
                      <div className="mt-3 h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500 rounded-full transition-all"
                          style={{ width: `${100 - pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        {Math.round(pct)}% ödendi · Toplam {fmtItem(l.total_amount, l.currency)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteLiability(l.id)}
                      className="text-gray-700 hover:text-red-400 transition-colors text-sm px-2 shrink-0"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ALACAKLAR */}
      <section className="mb-8">
        <SectionHeader
          label="Alacaklar"
          icon={<Scale size={18} className="text-amber-400" />}
          total={summary?.pending_receivables_try}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddReceivable(true)}
          addLabel="Alacak Ekle"
          addColor="amber"
        />

        {loading ? (
          <div className="space-y-2">
            {[1].map((i) => (
              <div key={i} className="h-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : receivables.length === 0 ? (
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">Alacak kaydı yok</p>
            <button
              onClick={() => setShowAddReceivable(true)}
              className="mt-3 text-amber-400 text-sm hover:text-amber-300 transition-colors"
            >
              + Alacak ekle
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {receivables.map((r) => {
              const isOverdue =
                r.status === "overdue" ||
                (r.status === "pending" && r.expected_date && r.expected_date < new Date().toISOString().slice(0, 10));
              const isReceived = r.status === "received";

              return (
                <div
                  key={r.id}
                  className={`bg-[#1A1A1A] border rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${
                    isOverdue ? "border-orange-800/40" : isReceived ? "border-emerald-900/40 opacity-60" : "border-[#2A2A2A]"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white text-sm font-medium">{r.from_person}</p>
                      {isReceived && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400">
                          Alındı ✓{r.linked_asset_id ? " · Varlığa bağlı" : ""}
                        </span>
                      )}
                      {isOverdue && !isReceived && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400">Gecikmiş</span>
                      )}
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {fmtItem(r.amount, r.currency)}
                      {r.expected_date && ` · ${r.expected_date}`}
                      {r.notes && ` · ${r.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isReceived && (
                      <button
                        onClick={() => handleMarkReceived(r.id)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-900/50 transition-colors"
                      >
                        Alındı
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteReceivable(r.id)}
                      className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1"
                      title={isReceived ? "Delete receivable and linked cash asset" : "Write off receivable"}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* AKILLI ÖNERİLER */}
      {pendingSuggestions.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-amber-400" />
            <h2 className="text-white font-semibold">Akıllı Öneriler</h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-950/50 border border-amber-800/40 text-amber-400 text-xs font-medium">
              {pendingSuggestions.length}
            </span>
          </div>
          <div className="space-y-3">
            {pendingSuggestions.map((s) => (
              <div
                key={s.id}
                className="bg-[#1A1A1A] border border-amber-900/30 rounded-xl p-4 flex items-start justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 text-sm">{s.reason}</p>
                  <p className="text-amber-400 text-xs mt-1 font-semibold tabular-nums">
                    {parseFloat(s.suggested_change) >= 0 ? "+" : ""}{parseFloat(s.suggested_change).toLocaleString("tr-TR")} {s.currency}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleAcceptSuggestion(s.id)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-800/40 hover:bg-indigo-600/30 text-xs font-medium transition-colors"
                  >
                    Uygula
                  </button>
                  <button
                    onClick={() => handleDismissSuggestion(s.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#2A2A2A] text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors"
                  >
                    Yoksay
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modals */}
      {showAddAsset && (
        <AddAssetModal
          onClose={() => setShowAddAsset(false)}
          onAdded={(asset) => {
            setAssets((prev) => [...prev, asset]);
            setShowAddAsset(false);
            void reloadSummary();
          }}
        />
      )}
      {showAddLiability && (
        <AddLiabilityModal
          onClose={() => setShowAddLiability(false)}
          onAdded={(liability) => {
            setLiabilities((prev) => [...prev, liability]);
            setShowAddLiability(false);
            void reloadSummary();
          }}
        />
      )}
      {showAddReceivable && (
        <AddReceivableModal
          onClose={() => setShowAddReceivable(false)}
          onAdded={(receivable) => {
            setReceivables((prev) => [...prev, receivable]);
            setShowAddReceivable(false);
            void reloadSummary();
          }}
        />
      )}
    </PageLayout>
  );
}

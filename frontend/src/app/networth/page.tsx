"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import AddAssetModal from "@/components/AddAssetModal";
import AddLiabilityModal from "@/components/AddLiabilityModal";
import GuidancePanel from "@/components/GuidancePanel";
import AllocationChart from "@/components/AllocationChart";
import AddReceivableModal from "@/components/AddReceivableModal";
import CurrencySelect from "@/components/CurrencySelect";
import {
  getToken,
  getCurrencyRates,
  getNetWorthGuidance,
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
  refreshAssetPrices,
  createNetWorthSnapshot,
  getNetWorthHistory,
  getWealthAlerts,
  checkWealthAlerts,
  createWealthAlert,
  deleteWealthAlert,
  generateDailyNotifications,
  getNetWorthAttribution,
  getDefaultCurrency,
  CURRENCY_CHANGE_EVENT,
  getAccounts,
  type NetWorthAttribution,
  AssetItem,
  LiabilityItem,
  ReceivableItem,
  NetWorthSummary,
  SuggestionItem,
  FinancialEventItem,
  ReconciliationItem,
  NetworthSnapshot,
  WealthAlertItem,
  TriggeredWealthAlert,
  GuidanceFinding,
} from "@/lib/api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import { Plus, TrendingUp, TrendingDown, DollarSign, Home, Wallet, Briefcase, Scale, Brain, Zap, RefreshCw, Pencil, MessageCircle, Bell } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

const AUTO_PRICE_TYPES = new Set(["crypto", "gold", "foreign_currency", "commodity", "stock", "fund"]);
// Price-drop alerts only make sense for genuinely priced assets — a fiat holding's
// "price" is just an exchange rate, so it's excluded from the alert bell.
const PRICED_ALERT_TYPES = new Set(["crypto", "stock", "fund", "gold", "commodity"]);

function fmt(value: number, currency = "TRY"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "TRY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value)} ${currency}`;
  }
}

function fmtItem(value: string, currency: string): string {
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  return fmt(n, currency);
}

// Convert amount from one currency to another using USD as pivot.
// rates: getCurrencyRates("USD") → rates[code] = units of code per 1 USD.
function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number> | null,
): number | null {
  if (!rates) return null;
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return amount;
  const fromRate = rates[from]; // units of 'from' per 1 USD
  const toRate = rates[to];    // units of 'to' per 1 USD
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

// Format a number without trailing-zero noise (0.05000000 → "0.05", 4000 → "4,000").
function trimNum(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(n);
}

function monthYear(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// Render a human, readable one-liner per asset type. NEVER returns raw JSON.
function assetDetailLabel(asset: AssetItem, t: (k: string) => string): string | null {
  let d: Record<string, unknown> = {};
  try { d = asset.source_detail ? (JSON.parse(asset.source_detail) as Record<string, unknown>) : {}; }
  catch { d = {}; }
  const s = (k: string): string | undefined => (typeof d[k] === "string" ? (d[k] as string).trim() || undefined : undefined);
  const tx = (key: string): string | null => { const v = t(key); return v !== key ? v : null; };
  const st = (s("subtype") || asset.asset_type) as string;
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

  switch (st) {
    case "crypto":
      return join([s("symbol") || asset.currency, trimNum(asset.current_value)]);
    case "foreign_currency":
      return join([s("code") || asset.currency, trimNum(asset.current_value)]);
    case "commodity":
      return join([s("code") || s("name") || asset.currency, trimNum(asset.current_value)]);
    case "gold": {
      const label = s("label") ? (tx(`assetForm.goldUnits.${s("label")}`) ?? s("label")!) : null;
      const qty = s("quantity") ?? (d.quantity != null ? String(d.quantity) : null);
      return join([label, qty ? trimNum(qty) : null]);
    }
    case "stock":
    case "fund": {
      const sym = s("symbol") || s("code");
      const shares = (asset.quantity && parseFloat(asset.quantity) > 0)
        ? `${trimNum(asset.quantity)} ${t("assetForm.units.piece")}`
        : (s("shares") ? `${trimNum(s("shares")!)} ${t("assetForm.units.piece")}` : (s("name") ?? null));
      return join([sym, shares]);
    }
    case "vehicle":
      return [s("brand"), s("model"), s("year")].filter(Boolean).join(" ") || null;
    case "bank_account": {
      const typeMap: Record<string, string> = {
        checking: "assetForm.bank.checking",
        time_deposit: "assetForm.bank.timeDeposit",
        participation: "assetForm.bank.participation",
      };
      const at = s("account_type");
      const typeLabel = at ? (tx(typeMap[at] ?? "") ?? null) : null;
      const rate = s("interest_rate") ? `%${s("interest_rate")}` : null;
      const mat = monthYear(s("maturity_date"));
      const matLabel = mat ? `${t("nw.maturityLabel")}: ${mat}` : null;
      return join([typeLabel || s("primary"), rate, matLabel]);
    }
    case "real_estate": {
      const pt = s("property_type") ? (tx(`assetForm.re.${s("property_type")}`) ?? s("property_type")!) : null;
      return join([pt, s("city"), s("sqm") ? `${s("sqm")} m²` : null]);
    }
    case "bond":
      return join([s("issuer"), s("coupon_rate") ? `%${s("coupon_rate")}` : null, monthYear(s("maturity_date"))]);
    case "life_insurance":
      return join([s("provider"), s("monthly_premium") ? `${trimNum(s("monthly_premium")!)}/${t("cashflow.legend.payment")}` : null]);
    case "business_ownership":
      return join([s("company"), s("pct") ? `%${s("pct")}` : null]);
    case "art_collectible":
    case "jewelry":
      return join([s("item"), s("insurance_value") ? trimNum(s("insurance_value")!) : null]);
    case "pension":
    case "bes":
      return join([s("primary") || s("provider"), s("secondary")]);
    default:
      // Generic manual subtypes — show captured fields, never the JSON.
      return join([s("primary"), s("secondary"), s("tertiary")]);
  }
}

function maturityCountdown(raw: string | null): { days: number; label: string } | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { maturity_date?: string };
    if (!d.maturity_date) return null;
    const days = Math.ceil((new Date(d.maturity_date).getTime() - Date.now()) / 86400000);
    if (days > 0) return { days, label: `Vadeye ${days} gün kaldı` };
    if (days === 0) return { days, label: "Bugün vade bitiyor" };
    return { days, label: "Vade doldu" };
  } catch { return null; }
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
    typeof detail.removed_asset_id === "string" ? `removed ${detail.removed_asset_id.slice(0, 8)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

async function loadOpenReconciliationItems(): Promise<ReconciliationItem[]> {
  await scanReconciliation().catch(() => null);
  return getReconciliationItems("open").catch(() => [] as ReconciliationItem[]);
}

function SectionHeader({
  label, icon, total, displayCurrency, onAdd, addLabel, addColor = "indigo", badge,
}: {
  label: string; icon: ReactNode; total?: number; displayCurrency: string;
  onAdd: () => void; addLabel: string; addColor?: string; badge?: ReactNode;
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
        {total !== undefined && <span className="text-sm text-gray-400">{fmt(total, displayCurrency)}</span>}
      </div>
      <button onClick={onAdd} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${btnColors[addColor] ?? btnColors.indigo}`}>
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  );
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-emerald-700 text-white rounded-lg px-4 py-3 shadow-lg text-sm max-w-xs">
      {message}
    </div>
  );
}

export default function NetWorthPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [displayCurrency, setDisplayCurrency] = useState("TRY");
  const [guidance, setGuidance] = useState<GuidanceFinding[]>([]);
  const [guidanceLoading, setGuidanceLoading] = useState(true);
  const [alertPct, setAlertPct] = useState(15);
  const alertsSectionRef = useRef<HTMLElement | null>(null);
  const [attribution, setAttribution] = useState<NetWorthAttribution | null>(null);
  const [accountsMap, setAccountsMap] = useState<Record<string, string>>({});

  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [liabilities, setLiabilities] = useState<LiabilityItem[]>([]);
  const [receivables, setReceivables] = useState<ReceivableItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [events, setEvents] = useState<FinancialEventItem[]>([]);
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [actionQueueOpen, setActionQueueOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [usdRates, setUsdRates] = useState<Record<string, number> | null>(null);

  const [snapshots, setSnapshots] = useState<NetworthSnapshot[]>([]);
  const [wealthAlerts, setWealthAlerts] = useState<WealthAlertItem[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredWealthAlert[]>([]);
  const [alertModalAsset, setAlertModalAsset] = useState<AssetItem | null>(null);
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);

  // Edit modals
  const [editingAsset, setEditingAsset] = useState<AssetItem | null>(null);
  const [editingLiability, setEditingLiability] = useState<LiabilityItem | null>(null);
  const [editingReceivable, setEditingReceivable] = useState<ReceivableItem | null>(null);

  // Focused analysis chat

  // Timestamp of the most recent price fetch (drives the "Xm ago" hint only).
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  const [showAddAsset, setShowAddAsset] = useState(false);
  const [addAssetInitialType, setAddAssetInitialType] = useState<string | undefined>(undefined);
  const [showAddLiability, setShowAddLiability] = useState(false);
  const [showAddReceivable, setShowAddReceivable] = useState(false);

  const SOURCE_LABELS: Record<string, string> = {
    manual: t("nw.sourceManual"),
    statement_upload: t("nw.sourceStatement"),
    receivable_collection: t("nw.sourceReceivable"),
    auto_detected: t("nw.sourceAuto"),
  };

  const ASSET_TYPE_GROUPS: { label: string; icon: ReactNode; types: string[] }[] = [
    { label: t("nw.groups.cashBank"), icon: <Wallet size={16} className="text-emerald-400" />, types: ["cash", "bank_account", "foreign_currency"] },
    { label: t("nw.groups.investments"), icon: <TrendingUp size={16} className="text-indigo-400" />, types: ["stock", "fund", "crypto", "bes", "gold", "bond", "commodity"] },
    { label: t("nw.groups.propertyVehicle"), icon: <Home size={16} className="text-amber-400" />, types: ["real_estate", "vehicle"] },
    { label: t("nw.groups.personalAssets"), icon: <Briefcase size={16} className="text-purple-400" />, types: ["art_collectible", "jewelry", "life_insurance", "pension", "business_ownership"] },
    { label: t("nw.groups.other"), icon: <Briefcase size={16} className="text-gray-400" />, types: ["other_asset"] },
  ];

  function getPriceBadge(asset: AssetItem): { label: string; cls: string } | null {
    if (!AUTO_PRICE_TYPES.has(asset.asset_type)) return null;
    let detail: Record<string, unknown> = {};
    try {
      if (asset.source_detail) detail = JSON.parse(asset.source_detail) as Record<string, unknown>;
    } catch { /* ignore */ }
    const fetchedAt = detail.price_fetched_at as string | undefined;
    if (!fetchedAt) return { label: t("nw.priceBadgeManual"), cls: "text-orange-400 bg-orange-950/30 border-orange-800/30" };
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin < 60) {
      const label = ageMin < 2 ? `${t("nw.priceBadgeAuto")} · ${t("nw.justNow")}` : `${t("nw.priceBadgeAuto")} · ${ageMin} ${t("nw.minAgo")}`;
      return { label, cls: "text-emerald-400 bg-emerald-950/30 border-emerald-800/30" };
    }
    const ageHours = Math.floor(ageMin / 60);
    if (ageHours < 24) return { label: `${t("nw.priceBadgeAuto")} · ${ageHours} ${t("nw.hrAgo")}`, cls: "text-amber-400 bg-amber-950/30 border-amber-800/30" };
    return { label: `${t("nw.priceBadgeAuto")} · ${t("nw.stale")}`, cls: "text-orange-400 bg-orange-950/30 border-orange-800/30" };
  }

  function getAssetTypeLabel(type: string): string {
    const key = `assetType.${type}`;
    const label = t(key);
    return label !== key ? label : type;
  }

  function getLiabilityTypeLabel(type: string): string {
    const key = `liabilityType.${type}`;
    const label = t(key);
    return label !== key ? label : type;
  }

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Honor the user's preferred display currency and react to Settings changes.
  useEffect(() => {
    setDisplayCurrency(getDefaultCurrency());
    const handler = (e: Event) => setDisplayCurrency((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  useEffect(() => {
    getAccounts().then((accs) => {
      setAccountsMap(Object.fromEntries(accs.map((a) => [a.id, a.name])));
    }).catch(() => setAccountsMap({}));
  }, []);

  // Manual assets go stale: flag those not refreshed in 90+ days so the number isn't trusted blindly.
  const staleDays = (asOf: string): number | null => {
    if (!asOf) return null;
    const d = Math.floor((Date.now() - new Date(`${asOf}T00:00:00`).getTime()) / 86400000);
    return d;
  };

  const loadAll = async () => {
    setLoading(true);
    getCurrencyRates("USD").then(setUsdRates).catch(() => null);
    // Guidance loads independently — its own engine + cache, never blocks the page.
    setGuidanceLoading(true);
    getNetWorthGuidance(displayCurrency, lang)
      .then((g) => setGuidance(g.findings))
      .catch(() => setGuidance([]))
      .finally(() => setGuidanceLoading(false));
    // Fire-and-forget: snapshot + alerts + notifications don't block page load
    createNetWorthSnapshot()
      .then(() => getNetWorthHistory(90)).then(setSnapshots)
      .then(() => getNetWorthAttribution(displayCurrency)).then(setAttribution)
      .catch(() => null);
    getWealthAlerts().then(setWealthAlerts).catch(() => null);
    checkWealthAlerts().then(setTriggeredAlerts).catch(() => null);
    generateDailyNotifications().catch(() => null);
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

      // Derive last refresh time from assets for cooldown
      const latestFetch = a.reduce<number | null>((best, asset) => {
        if (!AUTO_PRICE_TYPES.has(asset.asset_type)) return best;
        try {
          const d = asset.source_detail ? (JSON.parse(asset.source_detail) as Record<string, unknown>) : {};
          const fetchedAt = d.price_fetched_at as string | undefined;
          if (!fetchedAt) return best;
          const ts = new Date(fetchedAt).getTime();
          return best === null || ts > best ? ts : best;
        } catch { return best; }
      }, null);
      if (latestFetch) setLastRefreshAt(latestFetch);

      const needsRefresh = a.some((asset) => {
        if (!AUTO_PRICE_TYPES.has(asset.asset_type)) return false;
        try {
          const d = asset.source_detail ? (JSON.parse(asset.source_detail) as Record<string, unknown>) : {};
          const fetchedAt = d.price_fetched_at as string | undefined;
          if (!fetchedAt) return true;
          return Date.now() - new Date(fetchedAt).getTime() > 3600_000;
        } catch { return true; }
      });
      if (needsRefresh) {
        refreshAssetPrices()
          .then((result) => { if (result.updated > 0) return getAssets().then(setAssets); })
          .catch(() => {});
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  // Refresh after the global assistant confirms an action that mutates net worth data.
  const loadAllRef = useRef(loadAll);
  loadAllRef.current = loadAll;
  useEffect(() => {
    const handler = () => { void loadAllRef.current(); };
    window.addEventListener("mizan-data-changed", handler);
    return () => window.removeEventListener("mizan-data-changed", handler);
  }, []);

  const reloadGuidance = useCallback(() => {
    setGuidanceLoading(true);
    getNetWorthGuidance(displayCurrency, lang)
      .then((g) => setGuidance(g.findings))
      .catch(() => setGuidance([]))
      .finally(() => setGuidanceLoading(false));
  }, [displayCurrency, lang]);

  const reloadSummary = useCallback(async () => {
    setSummaryLoading(true);
    getNetWorthAttribution(displayCurrency).then(setAttribution).catch(() => null);
    // Guidance reacts to the new asset/liability picture — refetch it too.
    reloadGuidance();
    try { setSummary(await getNetWorthSummary(displayCurrency)); }
    finally { setSummaryLoading(false); }
  }, [displayCurrency, reloadGuidance]);

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

  const handleUpdateAsset = (updated: AssetItem) => {
    setAssets((prev) => prev.map((a) => a.id === updated.id ? updated : a));
    setEditingAsset(null);
    void reloadSummary();
  };

  const handleDeleteLiability = async (id: string) => {
    await deleteLiability(id);
    setLiabilities((prev) => prev.filter((l) => l.id !== id));
    void reloadSummary();
  };

  const handleUpdateLiability = (updated: LiabilityItem) => {
    setLiabilities((prev) => prev.map((l) => l.id === updated.id ? updated : l));
    setEditingLiability(null);
    void reloadSummary();
  };

  const handleUpdateReceivable = (updated: ReceivableItem) => {
    setReceivables((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    setEditingReceivable(null);
  };

  const handleDeleteReceivable = async (id: string) => {
    const receivable = receivables.find((r) => r.id === id);
    if (receivable?.status === "received" && receivable.linked_asset_id) {
      if (!window.confirm(t("nw.confirmDeleteLinkedReceivable"))) return;
    }
    await deleteReceivable(id);
    setReceivables((prev) => prev.filter((r) => r.id !== id));
    if (receivable?.linked_asset_id) setAssets((prev) => prev.filter((a) => a.id !== receivable.linked_asset_id));
    void reloadSummary();
    void reloadReconciliation();
  };

  const handleMarkReceived = async (id: string) => {
    const result = await updateReceivableStatus(id, "received");
    setReceivables((prev) => prev.map((r) => (r.id === id ? result.receivable : r)));
    if (result.created_asset) setAssets((prev) => [...prev, result.created_asset!]);
    if (result.toast_message) setToast(result.toast_message);
    void reloadSummary();
    void reloadReconciliation();
  };

  const handleAcceptSuggestion = async (id: string) => {
    await acceptSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    void reloadSummary();
    void loadAll();
  };

  const handleDismissSuggestion = async (id: string) => {
    await dismissSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleRefreshPrices = async () => {
    // Server-side caches (15 min crypto / 1 h fiat+stock) already throttle the
    // upstream APIs, so the button stays clickable — no client cooldown gating.
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await refreshAssetPrices();
      // Re-fetch FX/crypto/commodity rates too: live-value assets store a
      // quantity in current_value and are valued at display time via usdRates,
      // so without this their displayed value never moves after a refresh.
      getCurrencyRates("USD").then(setUsdRates).catch(() => null);
      const updatedAssets = await getAssets();
      setAssets(updatedAssets);
      setLastRefreshAt(Date.now());
      void reloadSummary();
      if (result.updated > 0) {
        setToast(`${result.updated} ${t("nw.toast.assetsUpdated")}${result.failed > 0 ? `, ${result.failed} ${t("nw.toast.failed")}` : ""}.`);
      } else if (result.failed > 0) {
        setToast(t("nw.toast.fetchFailed"));
      } else {
        setToast(t("nw.toast.noAutoPriceable"));
      }
    } catch {
      setToast(t("nw.toast.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  // Map a guidance finding's action to an in-page action or an assistant handoff.
  // Every finding resolves to either one click here or a grounded conversation.
  const handleGuidanceAction = (f: GuidanceFinding) => {
    const a = f.action;
    if (!a) return;
    switch (a.type) {
      case "refresh_prices":
        void handleRefreshPrices();
        break;
      case "create_alert": {
        const asset = assets.find((x) => x.id === a.params.asset_id);
        if (asset) setAlertModalAsset(asset);
        else openAssistantWith(f);
        break;
      }
      case "add_liability":
        setShowAddLiability(true);
        break;
      case "set_goal":
        router.push("/progress");
        break;
      case "discuss":
      default:
        openAssistantWith(f);
        break;
    }
  };

  const openAssistantWith = (f: GuidanceFinding) => {
    window.dispatchEvent(new CustomEvent("mizan-open-assistant", {
      detail: { prefill: `${f.observation} ${f.move}` },
    }));
  };

  const handleSaveAlert = async () => {
    if (!alertModalAsset || !alertThreshold || !alertMessage) return;
    const lastPrice = assetLastPriceUsd(alertModalAsset);
    if (!lastPrice || lastPrice <= 0) {
      setToast(t("nw.toast.alertNeedsPrice"));
      return;
    }
    const threshold = lastPrice * (1 - alertPct / 100);
    setAlertSaving(true);
    try {
      const newAlert = await createWealthAlert({
        alert_type: "asset_price_drop",
        asset_id: alertModalAsset.id,
        threshold_usd: threshold,
        message: alertMessage.trim() || `${alertModalAsset.name} −${alertPct}%`,
      });
      setWealthAlerts((prev) => [newAlert, ...prev]);
      setAlertModalAsset(null);
      setAlertMessage("");
      setToast(`${t("nw.toast.alertAdded")} ↓`);
      // Scroll to the alerts section so the user sees where it landed.
      setTimeout(() => alertsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } catch {
      setToast(t("nw.toast.alertSaveError"));
    } finally {
      setAlertSaving(false);
    }
  };

  // Per-unit USD price stored by the last price refresh (used for % drop alerts).
  function assetLastPriceUsd(a: AssetItem): number | null {
    try {
      const d = a.source_detail ? JSON.parse(a.source_detail) as Record<string, unknown> : {};
      const p = Number(d.last_price_usd);
      return p > 0 ? p : null;
    } catch {
      return null;
    }
  }

  const handleDeleteAlert = async (id: string) => {
    await deleteWealthAlert(id).catch(() => null);
    setWealthAlerts((prev) => prev.filter((a) => a.id !== id));
    setToast(t("nw.alertDeleted"));
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
          setToast(result.toast_message ?? t("nw.toast.receivableReceived"));
        } else if (action === "write_off") {
          await updateReceivableStatus(entityId, "written_off");
          setReceivables((prev) => prev.filter((r) => r.id !== entityId));
          setToast(t("nw.toast.receivableWrittenOff"));
        }
        const recStatus = action === "dismiss" ? "dismissed" : "resolved";
        await updateReconciliationItemStatus(item.id, recStatus);
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        void reloadSummary();
        return;
      }

      if (item.issue_type === "received_receivable_missing_asset" && entityId) {
        if (action === "create_cash_asset") {
          const result = await updateReceivableStatus(entityId, "received");
          setReceivables((prev) => prev.map((r) => r.id === entityId ? result.receivable : r));
          if (result.created_asset) setAssets((prev) => [...prev, result.created_asset!]);
          setToast(result.toast_message ?? t("nw.toast.cashAssetCreated"));
        } else if (action === "mark_pending") {
          const result = await updateReceivableStatus(entityId, "pending");
          setReceivables((prev) => prev.map((r) => r.id === entityId ? result.receivable : r));
          setToast(t("nw.toast.receivablePending"));
        } else if (action === "write_off") {
          await updateReceivableStatus(entityId, "written_off");
          setReceivables((prev) => prev.filter((r) => r.id !== entityId));
          setToast(t("nw.toast.receivableWrittenOff"));
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
            setToast(t("nw.toast.oneBatch"));
          } else {
            const ok = window.confirm(t("nw.confirmDeleteDuplicates"));
            if (!ok) { setActionPending(null); return; }
            for (const batchId of batchIds.slice(0, -1)) {
              await deleteBatch(batchId).catch(() => null);
            }
            setToast(`${batchIds.length - 1} ${t("nw.toast.duplicatesRemoved")}`);
          }
        }
        const dupStatus = action === "dismiss" ? "dismissed" : "resolved";
        await updateReconciliationItemStatus(item.id, dupStatus);
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        return;
      }

      if (item.issue_type === "large_transaction_review") {
        const finalStatus = action === "ignore" ? "dismissed" : "resolved";
        await updateReconciliationItemStatus(item.id, finalStatus);
        setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
        setToast(finalStatus === "resolved" ? t("nw.toast.txReviewed") : t("nw.toast.reviewDismissed"));
        return;
      }

      const finalStatus = action === "dismiss" ? "dismissed" : "resolved";
      await updateReconciliationItemStatus(item.id, finalStatus);
      setReconciliationItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      setToast(t("nw.toast.actionFailed"));
    } finally {
      setActionPending(null);
    }
  };

  const netPositive = (summary?.net_worth_try ?? 0) >= 0;
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  // History chart data: convert USD snapshots → displayCurrency
  const historyChartData = snapshots.map((s) => {
    const nwUsd = parseFloat(s.net_worth_usd);
    const converted = convertAmount(nwUsd, "USD", displayCurrency, usdRates) ?? nwUsd;
    const d = new Date(s.recorded_at);
    return {
      date: `${d.toLocaleString(undefined, { month: "short" })} ${d.getDate()}`,
      value: Math.round(converted),
    };
  });

  // Net worth delta from last 2 snapshots
  const nwDelta: { value: number; pct: number; positive: boolean } | null = (() => {
    if (historyChartData.length < 2) return null;
    const prev = historyChartData[historyChartData.length - 2].value;
    const curr = historyChartData[historyChartData.length - 1].value;
    if (prev === 0) return null;
    const diff = curr - prev;
    const pct = (diff / Math.abs(prev)) * 100;
    return { value: diff, pct, positive: diff >= 0 };
  })();

  // Allocation donut: wealth by high-level group, converted to display currency.
  const allocationSlices = ASSET_TYPE_GROUPS
    .map((g) => ({
      key: g.label,
      label: g.label,
      value: assets
        .filter((a) => g.types.includes(a.asset_type))
        .reduce((sum, a) => sum + (convertAmount(parseFloat(a.current_value), a.currency, displayCurrency, usdRates) ?? 0), 0),
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const currencyBars = summary
    ? Object.entries(summary.currency_breakdown)
        .map(([code, value]) => ({ code, value: Math.abs(value) }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <PageLayout
      title={t("nw.title")}
      subtitle={t("nw.subtitle")}
      maxWidth="lg"
      action={
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={handleRefreshPrices}
              disabled={refreshing}
              title={t("nw.refreshPricesTooltip")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-indigo-700 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? t("nw.refreshing") : t("nw.refreshPrices")}
            </button>
            {lastRefreshAt && !refreshing && (
              <span className="text-[10px] text-gray-600">
                {Math.floor((Date.now() - lastRefreshAt) / 60000)}m {t("nw.minAgo")}
              </span>
            )}
          </div>
          <div className="w-48">
            <CurrencySelect value={displayCurrency} onChange={setDisplayCurrency} />
          </div>
        </div>
      }
    >
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* Alert modal — % drop from the live per-unit price */}
      {alertModalAsset && (() => {
        const lastPrice = assetLastPriceUsd(alertModalAsset);
        const target = lastPrice ? lastPrice * (1 - alertPct / 100) : null;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setAlertModalAsset(null)}>
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-amber-400" />
              <h3 className="text-white font-semibold">{t("nw.addAlert")}</h3>
            </div>
            <p className="text-sm text-gray-400">{alertModalAsset.name}</p>

            {!lastPrice ? (
              <div className="bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2.5 text-amber-300 text-xs">
                {t("nw.toast.alertNeedsPrice")}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2.5">
                  <span className="text-gray-500">{t("nw.alertCurrentPrice")}</span>
                  <span className="text-gray-200 font-medium tabular-nums">${lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">{t("nw.alertNotifyIf")}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[10, 15, 20, 25].map((p) => (
                      <button key={p} onClick={() => setAlertPct(p)}
                        className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                          alertPct === p ? "bg-amber-600/20 border-amber-600/60 text-amber-300" : "bg-[#0F0F0F] border-[#2A2A2A] text-gray-400 hover:border-amber-700/50"
                        }`}>
                        −{p}%
                      </button>
                    ))}
                  </div>
                  {target !== null && (
                    <p className="text-xs text-gray-500 mt-2">
                      {t("nw.alertTriggersAt")} <span className="text-gray-300 font-medium tabular-nums">${target.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveAlert}
                disabled={alertSaving || !lastPrice}
                className="flex-1 bg-amber-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-amber-500 transition-colors disabled:opacity-40"
              >
                {alertSaving ? "…" : t("nw.alertSave")}
              </button>
              <button onClick={() => setAlertModalAsset(null)} className="px-4 py-2.5 rounded-lg bg-[#2A2A2A] text-gray-400 hover:text-gray-200 text-sm transition-colors">
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Hero */}
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 mb-6 text-center">
        {loading ? (
          <div className="space-y-3">
            <div className="h-12 w-64 bg-[#2A2A2A] rounded-lg mx-auto animate-pulse" />
            <div className="h-5 w-48 bg-[#2A2A2A] rounded mx-auto animate-pulse" />
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-sm mb-2">{t("nw.netWorth")}</p>
            <div className="flex items-center justify-center gap-3 mb-4">
              <p className={`text-5xl font-bold tabular-nums ${netPositive ? "text-emerald-400" : "text-red-400"} ${summaryLoading ? "opacity-50" : ""}`}>
                {summary ? fmt(summary.net_worth_try, displayCurrency) : "—"}
              </p>
              {nwDelta && (
                <span className={`text-sm font-semibold tabular-nums px-2 py-1 rounded-lg ${nwDelta.positive ? "bg-emerald-950/50 text-emerald-400" : "bg-red-950/50 text-red-400"}`}>
                  {nwDelta.positive ? "+" : ""}{fmt(nwDelta.value, displayCurrency)}
                  <span className="text-xs ml-1 opacity-70">({nwDelta.pct >= 0 ? "+" : ""}{nwDelta.pct.toFixed(1)}%)</span>
                </span>
              )}
            </div>

            {/* Why it moved — change attribution (compact, one line) */}
            {attribution && attribution.drivers.length > 0 && (
              <div className="flex items-center justify-center flex-wrap gap-1.5 mb-4 -mt-1">
                {attribution.drivers.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${
                      d.direction === "up" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/40 text-red-300"
                    }`}
                  >
                    {d.direction === "up" ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    <span className="text-gray-400 font-normal">{d.label}</span>
                    {d.direction === "up" ? "+" : "−"}{fmt(d.amount, displayCurrency)}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-center gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={14} className="text-emerald-400" />
                <span className="text-gray-400">{t("nw.assets")}</span>
                <span className="text-emerald-400 font-medium">{summary ? fmt(summary.total_assets_try, displayCurrency) : "—"}</span>
              </div>
              <span className="text-gray-700">—</span>
              <div className="flex items-center gap-1.5">
                <TrendingDown size={14} className="text-red-400" />
                <span className="text-gray-400">{t("nw.liabilities")}</span>
                <span className="text-red-400 font-medium">{summary ? fmt(summary.total_liabilities_try, displayCurrency) : "—"}</span>
              </div>
              {summary && summary.pending_receivables_try > 0 && (
                <>
                  <span className="text-gray-700">+</span>
                  <div className="flex items-center gap-1.5">
                    <DollarSign size={14} className="text-amber-400" />
                    <span className="text-gray-400">{t("nw.receivables")}</span>
                    <span className="text-amber-400 font-medium">{fmt(summary.pending_receivables_try, displayCurrency)}</span>
                  </div>
                </>
              )}
            </div>
            {summary && Object.keys(summary.currency_breakdown).length > 1 && (
              <div className="mt-5 pt-5 border-t border-[#2A2A2A] flex flex-wrap gap-3 justify-center">
                {Object.entries(summary.currency_breakdown).sort(([, a], [, b]) => b - a).map(([cur, val]) => (
                  <span key={cur} className="px-2.5 py-1 rounded-full bg-[#2A2A2A] text-xs text-gray-400">{cur}: {fmt(val, "TRY")}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Empty state — guide first asset */}
      {!loading && assets.length === 0 && liabilities.length === 0 && receivables.length === 0 && (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 mb-6">
          <p className="text-white font-semibold mb-1">{t("nw.empty.title")}</p>
          <p className="text-gray-500 text-sm mb-5">{t("nw.empty.subtitle")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { type: "bank_account", emoji: "💰", label: t("nw.empty.cashBank") },
              { type: "stock", emoji: "📈", label: t("nw.empty.investment") },
              { type: "real_estate", emoji: "🏠", label: t("nw.empty.realEstate") },
            ].map((c) => (
              <button
                key={c.type}
                onClick={() => { setAddAssetInitialType(c.type); setShowAddAsset(true); }}
                className="flex flex-col items-center gap-2 p-5 rounded-xl bg-[#0F0F0F] border border-[#2A2A2A] hover:border-indigo-600 transition-colors"
              >
                <span className="text-2xl">{c.emoji}</span>
                <span className="text-white text-sm font-medium">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI guidance — ranked, benchmarked, action-linked findings */}
      <GuidancePanel findings={guidance} loading={guidanceLoading} onAction={handleGuidanceAction} t={t} />

      {/* Triggered wealth alerts */}
      {triggeredAlerts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {triggeredAlerts.map((ta) => (
            <div key={ta.alert.id} className="flex items-start gap-2 bg-red-950/30 border border-red-800/40 rounded-xl px-4 py-3">
              <span className="text-red-400 shrink-0">🔔</span>
              <div className="flex-1 min-w-0">
                <p className="text-red-200 text-sm font-medium">{ta.alert.message_template}</p>
                <p className="text-red-400/70 text-xs mt-0.5">{ta.triggered_reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Net worth history chart */}
      {!loading && (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs text-gray-400 font-medium">{t("nw.historyTitle")}</h3>
            {snapshots.some((s) => s.estimated) && historyChartData.length >= 2 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-900/40 text-amber-400/90">
                {t("scorecard.trajectory.estimated")}
              </span>
            )}
          </div>
          {historyChartData.length < 2 ? (
            <p className="text-gray-600 text-xs">{t("nw.historyNoData")}</p>
          ) : (
            <AreaChart width={600} height={120} data={historyChartData} style={{ width: "100%", maxWidth: "100%" }}>
              <defs>
                <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <RechartsTooltip
                contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [fmt(v, displayCurrency), ""]}
              />
              <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#nwGrad)" dot={false} />
            </AreaChart>
          )}
        </div>
      )}

      {/* Asset allocation — interactive donut + per-currency exposure */}
      {!loading && (
        <AllocationChart
          slices={allocationSlices}
          currencyBars={currencyBars}
          displayCurrency={displayCurrency}
          t={t}
        />
      )}

      {/* Assets */}
      <section className="mb-8">
        <SectionHeader
          label={t("nw.assets")}
          icon={<TrendingUp size={18} className="text-emerald-400" />}
          total={summary?.total_assets_try}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddAsset(true)}
          addLabel={t("nw.addAsset")}
          addColor="indigo"
        />
        {loading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" />)}</div>
        ) : assets.length === 0 ? (
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">{t("nw.noAssets")}</p>
            <button onClick={() => setShowAddAsset(true)} className="mt-3 text-indigo-400 text-sm hover:text-indigo-300 transition-colors">{t("nw.addFirstAsset")}</button>
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
                    const detailLabel = assetDetailLabel(a, t);
                    const priceBadge = getPriceBadge(a);
                    const maturity = a.asset_type === "bank_account" ? maturityCountdown(a.source_detail ?? null) : null;
                    return (
                      <div key={a.id} className={`flex items-center justify-between px-4 py-3 ${idx < groupAssets.length - 1 ? "border-b border-[#2A2A2A]" : ""}`}>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-white text-sm font-medium">{a.name}</p>
                            {priceBadge && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${priceBadge.cls}`}>{priceBadge.label}</span>
                            )}
                            {maturity && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                                maturity.days <= 0 ? "bg-amber-950/40 border-amber-700/40 text-amber-400"
                                  : maturity.days <= 7 ? "bg-orange-950/40 border-orange-700/40 text-orange-400"
                                  : "bg-[#1A1A1A] border-[#2A2A2A] text-gray-400"
                              }`}>{maturity.label}</span>
                            )}
                            {!AUTO_PRICE_TYPES.has(a.asset_type) && !priceBadge && (() => {
                              const d = staleDays(a.as_of_date);
                              return d !== null && d >= 90 ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-orange-950/30 border-orange-800/30 text-orange-400" title={t("nw.staleHint")}>
                                  {t("nw.stale")}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{getAssetTypeLabel(a.asset_type)}</span>
                            {a.account_id && accountsMap[a.account_id] && (
                              <span className="text-indigo-400">· {accountsMap[a.account_id]}</span>
                            )}
                            {detailLabel && <span className="text-gray-400">· {detailLabel}</span>}
                            {a.notes && <span>· {a.notes}</span>}
                            <span className="text-gray-600">· {SOURCE_LABELS[a.source] ?? a.source}</span>
                            {a.as_of_date && <span className="text-gray-600">· {a.as_of_date}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            {(() => {
                              const raw = parseFloat(a.current_value);
                              const converted = convertAmount(raw, a.currency, displayCurrency, usdRates);
                              const showConverted = converted !== null && a.currency.toUpperCase() !== displayCurrency.toUpperCase();
                              const nativeHint = showConverted ? fmtItem(a.current_value, a.currency) : undefined;
                              return (
                                <p
                                  title={nativeHint}
                                  className={`text-emerald-400 text-sm font-semibold tabular-nums${nativeHint ? " cursor-help" : ""}`}
                                >
                                  {showConverted ? fmt(converted!, displayCurrency) : fmtItem(a.current_value, a.currency)}
                                </p>
                              );
                            })()}
                          </div>
                          {PRICED_ALERT_TYPES.has(a.asset_type) && (
                            <button
                              onClick={() => { setAlertModalAsset(a); setAlertPct(15); setAlertMessage(""); }}
                              title={t("nw.addAlert")}
                              className="text-gray-700 hover:text-amber-400 transition-colors px-1"
                            >
                              <Bell size={13} />
                            </button>
                          )}
                          <button onClick={() => setEditingAsset(a)} title={t("common.edit")} className="text-gray-700 hover:text-indigo-400 transition-colors px-1">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDeleteAsset(a.id)} className="text-gray-700 hover:text-red-400 transition-colors text-xs px-2">×</button>
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

      {/* Liabilities */}
      <section className="mb-8">
        <SectionHeader
          label={t("nw.liabilities")}
          icon={<TrendingDown size={18} className="text-red-400" />}
          total={summary?.total_liabilities_try}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddLiability(true)}
          addLabel={t("nw.addLiability")}
          addColor="red"
        />
        {loading ? (
          <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-20 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" />)}</div>
        ) : liabilities.length === 0 ? (
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">{t("nw.noLiabilities")}</p>
            <button onClick={() => setShowAddLiability(true)} className="mt-3 text-red-400 text-sm hover:text-red-300 transition-colors">{t("nw.addFirstLiability")}</button>
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
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#2A2A2A] text-gray-400">{getLiabilityTypeLabel(l.liability_type)}</span>
                        {highInterest && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-800/40">
                            %{l.interest_rate} {t("nw.highInterest").replace("% ", "")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>{t("nw.remaining")}: <span className="text-red-400 font-medium">{fmtItem(l.remaining_amount, l.currency)}</span></span>
                        {l.monthly_payment && <span>{t("nw.monthly")}: {fmtItem(l.monthly_payment, l.currency)}</span>}
                        {l.due_date && <span>{t("nw.due")}: {l.due_date}</span>}
                      </div>
                      <div className="mt-3 h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${100 - pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{Math.round(pct)}{t("nw.totalPaid")} · {t("nw.total")} {fmtItem(l.total_amount, l.currency)}</p>
                    </div>
                    <button onClick={() => setEditingLiability(l)} title={t("common.edit")} className="text-gray-700 hover:text-indigo-400 transition-colors px-1 shrink-0">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDeleteLiability(l.id)} className="text-gray-700 hover:text-red-400 transition-colors text-sm px-2 shrink-0">×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Receivables */}
      <section className="mb-8">
        <SectionHeader
          label={t("nw.receivables")}
          icon={<Scale size={18} className="text-amber-400" />}
          total={summary?.pending_receivables_try}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddReceivable(true)}
          addLabel={t("nw.addReceivable")}
          addColor="amber"
        />
        {loading ? (
          <div className="space-y-2"><div className="h-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" /></div>
        ) : receivables.length === 0 ? (
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">{t("nw.noReceivables")}</p>
            <button onClick={() => setShowAddReceivable(true)} className="mt-3 text-amber-400 text-sm hover:text-amber-300 transition-colors">{t("nw.addFirstReceivable")}</button>
          </div>
        ) : (
          <div className="space-y-2">
            {receivables.map((r) => {
              const isOverdue = r.status === "overdue" || (r.status === "pending" && r.expected_date && r.expected_date < new Date().toISOString().slice(0, 10));
              const isReceived = r.status === "received";
              return (
                <div key={r.id} className={`bg-[#1A1A1A] border rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${isOverdue ? "border-orange-800/40" : isReceived ? "border-emerald-900/40 opacity-60" : "border-[#2A2A2A]"}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white text-sm font-medium">{r.from_person}</p>
                      {isReceived && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400">
                          {t("nw.received")} ✓{r.linked_asset_id ? ` · ${t("nw.linkedAsset")}` : ""}
                        </span>
                      )}
                      {isOverdue && !isReceived && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400">{t("nw.overdue")}</span>
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
                      <button onClick={() => handleMarkReceived(r.id)} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-900/50 transition-colors">
                        {t("nw.markReceived")}
                      </button>
                    )}
                    <button onClick={() => setEditingReceivable(r)} title={t("common.edit")} className="text-gray-700 hover:text-indigo-400 transition-colors px-1">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDeleteReceivable(r.id)} className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1">×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Smart Suggestions */}
      {pendingSuggestions.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-amber-400" />
            <h2 className="text-white font-semibold">{t("nw.suggestions")}</h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-950/50 border border-amber-800/40 text-amber-400 text-xs font-medium">
              {pendingSuggestions.length}
            </span>
          </div>
          <div className="space-y-3">
            {pendingSuggestions.map((s) => (
              <div key={s.id} className="bg-[#1A1A1A] border border-amber-900/30 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 text-sm">{s.reason}</p>
                  <p className="text-amber-400 text-xs mt-1 font-semibold tabular-nums">
                    {parseFloat(s.suggested_change) >= 0 ? "+" : ""}{parseFloat(s.suggested_change).toLocaleString()} {s.currency}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleAcceptSuggestion(s.id)} className="px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-800/40 hover:bg-indigo-600/30 text-xs font-medium transition-colors">
                    {t("nw.accept")}
                  </button>
                  <button onClick={() => handleDismissSuggestion(s.id)} className="px-3 py-1.5 rounded-lg bg-[#2A2A2A] text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors">
                    {t("nw.rejectSuggestion")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && (
        <section className="mb-8">
          <button
            onClick={() => setActionQueueOpen((v) => !v)}
            className="w-full flex items-center gap-2 mb-4 text-left"
          >
            <Zap size={18} className="text-cyan-400" />
            <h2 className="text-white font-semibold">{t("nw.actionQueue")}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              reconciliationItems.length > 0
                ? "bg-cyan-950/50 border border-cyan-800/40 text-cyan-300"
                : "bg-[#2A2A2A] text-gray-500"
            }`}>
              {reconciliationItems.length}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`ml-auto text-gray-500 transition-transform ${actionQueueOpen ? "rotate-180" : ""}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {actionQueueOpen && reconciliationItems.length === 0 && (
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 flex items-center gap-3 mb-3 text-gray-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
              <span className="text-sm">{t("nw.allClear")}</span>
            </div>
          )}

          {actionQueueOpen && reconciliationItems.length > 0 && (
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

                // Translated title — keyed by issue_type, ignores backend English string.
                const itemTitle = (() => {
                  if (item.issue_type === "overdue_receivable") return t("nw.recon.overdueTitle");
                  if (item.issue_type === "received_receivable_missing_asset") return t("nw.recon.missingAssetTitle");
                  if (item.issue_type === "possible_duplicate_transaction") return t("nw.recon.duplicateTitle");
                  if (item.issue_type === "large_transaction_review") return t("nw.recon.largeTxTitle");
                  return item.title;
                })();

                // Context line — built from proposed_action values, not from backend description.
                const contextLine = (() => {
                  if (item.issue_type === "overdue_receivable" && pa?.amount) {
                    return `${String(pa.amount)} ${String(pa.currency ?? "")} ${t("nw.recon.overdueContext")} ${String(pa.expected_date ?? "")}`;
                  }
                  if (item.issue_type === "received_receivable_missing_asset" && pa?.amount) {
                    return `${String(pa.amount)} ${String(pa.currency ?? "")} — ${t("nw.recon.missingAssetContext")}`;
                  }
                  if (item.issue_type === "possible_duplicate_transaction" && pa?.description) {
                    const count = (pa.transaction_ids as string[] | undefined)?.length ?? 2;
                    return `×${count} — "${String(pa.description).slice(0, 50)}"`;
                  }
                  if (item.issue_type === "large_transaction_review" && pa?.amount) {
                    const sign = String(pa.transaction_type) === "debit" ? "−" : "+";
                    return `${sign}${String(pa.amount)}${pa.description ? ` · "${String(pa.description).slice(0, 40)}"` : ""}`;
                  }
                  return null;
                })();

                // Subtitle — user-facing plain-language explanation.
                const subtitle = (() => {
                  if (item.issue_type === "overdue_receivable") return t("nw.recon.overdueSubtitle");
                  if (item.issue_type === "received_receivable_missing_asset") return t("nw.recon.missingAssetSubtitle");
                  if (item.issue_type === "possible_duplicate_transaction") return t("nw.recon.duplicateSubtitle");
                  if (item.issue_type === "large_transaction_review") return t("nw.recon.largeTxSubtitle");
                  return null;
                })();

                let actionButtons: ReactNode;
                if (item.issue_type === "overdue_receivable") {
                  actionButtons = (<>
                    {btn("mark_received", t("nw.markReceived"), "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                    {btn("write_off", t("nw.writeOff"), "bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20")}
                    {btn("dismiss", t("common.dismiss"), "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                  </>);
                } else if (item.issue_type === "received_receivable_missing_asset") {
                  actionButtons = (<>
                    {btn("create_cash_asset", t("nw.addAsset"), "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                    {btn("mark_pending", t("nw.pending"), "bg-amber-600/10 text-amber-400 border border-amber-800/30 hover:bg-amber-600/20")}
                    {btn("write_off", t("nw.writeOff"), "bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20")}
                  </>);
                } else if (item.issue_type === "possible_duplicate_transaction") {
                  const batchIds = (pa?.upload_batch_ids as string[] | undefined) ?? [];
                  actionButtons = (<>
                    {batchIds.length >= 2 && btn("delete_duplicate_batch", t("nw.recon.deleteOlderDuplicate"), "bg-red-600/10 text-red-400 border border-red-800/30 hover:bg-red-600/20")}
                    {btn("keep_all", t("nw.recon.keepAll"), "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                    {btn("dismiss", t("common.dismiss"), "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                  </>);
                } else if (item.issue_type === "large_transaction_review") {
                  actionButtons = (<>
                    {btn("confirm_category", t("common.confirm"), "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                    {btn("ignore", t("common.dismiss"), "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                  </>);
                } else {
                  actionButtons = (<>
                    {btn("resolve", t("common.resolve"), "bg-emerald-600/20 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-600/30")}
                    {btn("dismiss", t("common.dismiss"), "bg-[#2A2A2A] text-gray-400 hover:text-gray-200")}
                  </>);
                }

                return (
                  <div key={item.id} className="bg-[#1A1A1A] border border-cyan-900/30 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-gray-100 text-sm font-medium">{itemTitle}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            item.severity === "high" ? "bg-red-950/50 text-red-400 border border-red-800/30"
                              : item.severity === "medium" ? "bg-amber-950/50 text-amber-400 border border-amber-800/30"
                              : "bg-[#2A2A2A] text-gray-400"
                          }`}>
                            {item.severity}
                          </span>
                        </div>
                        {contextLine && (
                          <p className="text-cyan-300/70 text-xs mt-1 truncate">{contextLine}</p>
                        )}
                        {subtitle && (
                          <p className="text-gray-500 text-xs leading-relaxed mt-1">{subtitle}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap mt-3">{actionButtons}</div>
                  </div>
                );
              })}
            </div>
          )}

          {actionQueueOpen && events.length > 0 && (
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#2A2A2A] bg-[#111]">
                <span className="text-xs text-gray-400 font-medium">{t("nw.recentEvents")}</span>
              </div>
              {events.map((event, idx) => {
                const detail = eventDetail(event.source_detail);
                return (
                  <div key={event.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${idx < events.length - 1 ? "border-b border-[#2A2A2A]" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-gray-200 text-sm">{eventLabel(event.event_type)}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {event.event_date} · {event.entity_type}{detail ? ` · ${detail}` : ""}
                      </p>
                    </div>
                    {event.amount && event.currency && (
                      <p className="text-gray-300 text-sm font-semibold tabular-nums shrink-0">{fmtItem(event.amount, event.currency)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Wealth alerts list — dedicated, visually distinct section */}
      {!loading && wealthAlerts.length > 0 && (
        <section ref={alertsSectionRef} className="mb-8 bg-amber-950/10 border border-amber-900/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-amber-950/50 border border-amber-900/50 flex items-center justify-center">
              <Bell size={14} className="text-amber-400" />
            </div>
            <h2 className="text-white font-semibold text-sm flex-1">{t("nw.wealthAlerts")}</h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/30 text-amber-400 text-xs font-medium">{wealthAlerts.length}</span>
          </div>
          <div className="space-y-2">
            {wealthAlerts.map((a) => (
              <div key={a.id} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-gray-200 text-sm truncate">{a.message_template}</p>
                    <p className="text-gray-600 text-xs mt-0.5">
                      {a.threshold_usd !== null && `${t("nw.alertTriggersAt")} $${a.threshold_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => handleDeleteAlert(a.id)} title={t("common.delete")} className="text-gray-700 hover:text-red-400 transition-colors text-xs px-1 shrink-0">×</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {showAddAsset && (
        <AddAssetModal displayCurrency={displayCurrency} initialType={addAssetInitialType} onClose={() => { setShowAddAsset(false); setAddAssetInitialType(undefined); }} onAdded={(asset) => { setAssets((prev) => [...prev, asset]); setShowAddAsset(false); setAddAssetInitialType(undefined); void reloadSummary(); }} />
      )}
      {editingAsset && (
        <AddAssetModal displayCurrency={displayCurrency} editData={editingAsset} onClose={() => setEditingAsset(null)} onAdded={() => setEditingAsset(null)} onUpdated={handleUpdateAsset} />
      )}
      {showAddLiability && (
        <AddLiabilityModal onClose={() => setShowAddLiability(false)} onAdded={(liability) => { setLiabilities((prev) => [...prev, liability]); setShowAddLiability(false); void reloadSummary(); }} />
      )}
      {editingLiability && (
        <AddLiabilityModal editData={editingLiability} onClose={() => setEditingLiability(null)} onAdded={() => setEditingLiability(null)} onUpdated={handleUpdateLiability} />
      )}
      {showAddReceivable && (
        <AddReceivableModal onClose={() => setShowAddReceivable(false)} onAdded={(receivable) => { setReceivables((prev) => [...prev, receivable]); setShowAddReceivable(false); void reloadSummary(); }} />
      )}
      {editingReceivable && (
        <AddReceivableModal editData={editingReceivable} onClose={() => setEditingReceivable(null)} onAdded={() => setEditingReceivable(null)} onUpdated={handleUpdateReceivable} />
      )}
    </PageLayout>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import AddAssetModal from "@/components/AddAssetModal";
import AddLiabilityModal, { type LiabilityPrefill } from "@/components/AddLiabilityModal";
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
  getWealthAlerts,
  checkWealthAlerts,
  createWealthAlert,
  deleteWealthAlert,
  generateDailyNotifications,
  getNetWorthAttribution,
  getDefaultCurrency,
  CURRENCY_CHANGE_EVENT,
  getAccounts,
  PaidFeatureError,
  type NetWorthAttribution,
  AssetItem,
  LiabilityItem,
  ReceivableItem,
  NetWorthSummary,
  SuggestionItem,
  FinancialEventItem,
  ReconciliationItem,
  WealthAlertItem,
  TriggeredWealthAlert,
  GuidanceFinding,
} from "@/lib/api";
import { Plus, TrendingUp, TrendingDown, DollarSign, Home, Wallet, Briefcase, Scale, Brain, Zap, RefreshCw, Pencil, MessageCircle, Bell, X } from "@/components/ui/Icons";
import { useLanguage, getCurrentLang } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

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

// Locale-aware clock: Turkish convention is 24h ("23:04"); English uses 12h ("11:04 PM").
function fmtTime(ms: number, lang: string): string {
  return new Date(ms).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", {
    hour: "2-digit", minute: "2-digit", hour12: lang !== "tr",
  });
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

function maturityCountdown(raw: string | null, t: (k: string) => string): { days: number; label: string } | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { maturity_date?: string };
    if (!d.maturity_date) return null;
    const days = Math.ceil((new Date(d.maturity_date).getTime() - Date.now()) / 86400000);
    if (days > 0) return { days, label: t("nw.maturityDaysLeft").replace("{n}", String(days)) };
    if (days === 0) return { days, label: t("nw.maturityToday") };
    return { days, label: t("nw.maturityExpired") };
  } catch { return null; }
}

function eventLabel(eventType: string, t: (k: string) => string): string {
  const key = `nw.event.${eventType}`;
  const label = t(key);
  return label !== key ? label : eventType.replaceAll("_", " ");
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
  label, icon, total, count, displayCurrency, onAdd, addLabel, addColor = "indigo", iconTint = "bg-surface-2", badge,
}: {
  label: string; icon: ReactNode; total?: number; count?: number; displayCurrency: string;
  onAdd: () => void; addLabel: string; addColor?: string; iconTint?: string; badge?: ReactNode;
}) {
  void addColor;
  return (
    <div className="flex items-center justify-between mb-4 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconTint}`}>{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-ink font-semibold leading-tight">{label}</h2>
            {count !== undefined && count > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-2 text-ink-mute font-medium tabular-nums">{count}</span>
            )}
            {badge}
          </div>
          {total !== undefined && <span className="text-xs text-ink-mute tabular-nums">{fmt(total, displayCurrency)}</span>}
        </div>
      </div>
      <button onClick={onAdd} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm transition-colors shrink-0">
        <Plus size={14} />
        {addLabel}
      </button>
    </div>
  );
}

function SectionEmpty({
  icon, iconTint, title, desc, ctaLabel, onCta,
}: {
  icon: ReactNode; iconTint: string; title: string; desc: string; ctaLabel: string; onCta: () => void;
}) {
  return (
    <div className="bg-surface border border-line border-dashed rounded-2xl px-6 py-10 flex flex-col items-center text-center">
      <span className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${iconTint}`}>{icon}</span>
      <p className="text-ink font-semibold text-sm">{title}</p>
      <p className="text-ink-mute text-xs mt-1 max-w-xs leading-relaxed">{desc}</p>
      <button
        onClick={onCta}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm transition-colors"
      >
        <Plus size={14} />
        {ctaLabel}
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
    <div className="fixed bottom-4 right-4 z-50 bg-[#176B5B] text-white rounded-lg px-4 py-3 shadow-lg shadow-black/20 text-sm max-w-xs">
      {message}
    </div>
  );
}

export default function NetWorthPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  // Explicit theme-resolved colors for cases the channel-token bg utilities don't
  // paint reliably at runtime: floating overlays (alert modal) and solid in-flow
  // fills (liability progress bar). text-/border- tokens are fine; only solid
  // bg-<token> fills need this.
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  const NEG = resolved === "dark" ? "#D17474" : "#B54747";
  // Initialize from the user's saved default BEFORE the first fetch, so loadAll()
  // always queries the summary in the correct currency. (Previously this started
  // as "TRY" and flipped to USD via an effect AFTER loadAll had already fetched,
  // racing the late USD refetch and sometimes leaving TRY values labelled USD.)
  const [displayCurrency, setDisplayCurrency] = useState<string>(() => getDefaultCurrency());
  const [guidance, setGuidance] = useState<GuidanceFinding[]>([]);
  const [guidanceLoading, setGuidanceLoading] = useState(true);
  const [guidancePaywalled, setGuidancePaywalled] = useState(false);
  const [alertPct, setAlertPct] = useState(15);
  const alertsSectionRef = useRef<HTMLElement | null>(null);
  // Synchronous in-flight guard — prevents the manual button and the auto-refresh
  // in loadAll from firing overlapping POST /refresh-prices calls (React state is
  // async, so a ref is the only reliable single-flight lock).
  const refreshInFlightRef = useRef(false);
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
  const [liabPrefill, setLiabPrefill] = useState<{ suggestionId: string; prefill: LiabilityPrefill } | null>(null);
  const [showAddReceivable, setShowAddReceivable] = useState(false);

  const SOURCE_LABELS: Record<string, string> = {
    manual: t("nw.sourceManual"),
    statement_upload: t("nw.sourceStatement"),
    receivable_collection: t("nw.sourceReceivable"),
    auto_detected: t("nw.sourceAuto"),
  };

  const ASSET_TYPE_GROUPS: { label: string; icon: ReactNode; types: string[] }[] = [
    { label: t("nw.groups.cashBank"), icon: <Wallet size={16} className="text-pos" />, types: ["cash", "bank_account", "foreign_currency"] },
    { label: t("nw.groups.investments"), icon: <TrendingUp size={16} className="text-brand" />, types: ["stock", "fund", "crypto", "bes", "gold", "bond", "commodity"] },
    { label: t("nw.groups.propertyVehicle"), icon: <Home size={16} className="text-warn" />, types: ["real_estate", "vehicle"] },
    { label: t("nw.groups.personalAssets"), icon: <Briefcase size={16} className="text-ink-soft" />, types: ["art_collectible", "jewelry", "life_insurance", "pension", "business_ownership"] },
    { label: t("nw.groups.other"), icon: <Briefcase size={16} className="text-ink-mute" />, types: ["other_asset"] },
  ];

  function getPriceBadge(asset: AssetItem): { label: string; cls: string; title?: string } | null {
    if (!AUTO_PRICE_TYPES.has(asset.asset_type)) return null;
    let detail: Record<string, unknown> = {};
    try {
      if (asset.source_detail) detail = JSON.parse(asset.source_detail) as Record<string, unknown>;
    } catch { /* ignore */ }
    const fetchedAt = detail.price_fetched_at as string | undefined;
    if (!fetchedAt) return { label: t("nw.priceBadgeManual"), cls: "text-warn bg-warn/10 border-warn/30" };
    const when = new Date(fetchedAt);
    const ageMin = Math.floor((Date.now() - when.getTime()) / 60000);
    // Concrete clock time so the user can see it tick to "now" after a refresh,
    // even when a stable price means the value itself doesn't move.
    const clock = fmtTime(when.getTime(), lang);
    const rel = ageMin < 2 ? t("nw.justNow") : ageMin < 60 ? `${ageMin} ${t("nw.minAgo")}` : `${Math.floor(ageMin / 60)} ${t("nw.hrAgo")}`;
    const title = `${t("nw.priceBadgeUpdated")} ${clock} · ${rel}`;
    if (ageMin < 60) return { label: `${t("nw.priceBadgeUpdated")} ${clock}`, cls: "text-pos bg-pos/10 border-pos/30", title };
    if (ageMin < 1440) return { label: `${t("nw.priceBadgeUpdated")} ${clock}`, cls: "text-warn bg-warn/10 border-warn/30", title };
    return { label: `${t("nw.priceBadgeAuto")} · ${t("nw.stale")}`, cls: "text-warn bg-warn/10 border-warn/30", title };
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

  // Deep link: /networth?add=asset (used by the Home first-run tour card) opens the
  // add-asset modal straight away, then cleans the query so a refresh doesn't reopen it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") === "asset") {
      setShowAddAsset(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // React to live currency changes from Settings / the navbar selector. The
  // initial value already comes from the lazy useState initializer above, so we
  // only need the listener here (no mount-time setDisplayCurrency that would race).
  useEffect(() => {
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
    // Use getCurrentLang() (resolved synchronously) instead of the hook's `lang`, which
    // is "tr" on the very first render and would fetch — and cache-show — Turkish
    // guidance even when the app is in English.
    setGuidanceLoading(true);
    getNetWorthGuidance(displayCurrency, getCurrentLang())
      .then((g) => { setGuidance(g.findings); setGuidancePaywalled(false); })
      .catch((err) => { setGuidance([]); setGuidancePaywalled(err instanceof PaidFeatureError); })
      .finally(() => setGuidanceLoading(false));
    // Keep recording the daily snapshot so REAL history accrues over time (the
    // trajectory chart lives on the Progress page). We just don't render an
    // estimated/reconstructed history chart here — it was misleading.
    createNetWorthSnapshot()
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
      if (needsRefresh && !refreshInFlightRef.current) {
        refreshInFlightRef.current = true;
        refreshAssetPrices()
          .then(async (result) => {
            const rates = await getCurrencyRates("USD").catch(() => null);
            if (rates) setUsdRates(rates);
            if (result.updated > 0) setAssets(await getAssets());
            setLastRefreshAt(Date.now());
          })
          .catch(() => {})
          .finally(() => { refreshInFlightRef.current = false; });
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

  // Auto-expand the action queue once if anything urgent (high severity) is waiting.
  const autoOpenedQueueRef = useRef(false);
  useEffect(() => {
    if (autoOpenedQueueRef.current) return;
    if (reconciliationItems.some((i) => i.severity === "high")) {
      setActionQueueOpen(true);
      autoOpenedQueueRef.current = true;
    }
  }, [reconciliationItems]);

  const reloadGuidance = useCallback(() => {
    setGuidanceLoading(true);
    getNetWorthGuidance(displayCurrency, getCurrentLang())
      .then((g) => { setGuidance(g.findings); setGuidancePaywalled(false); })
      .catch((err) => { setGuidance([]); setGuidancePaywalled(err instanceof PaidFeatureError); })
      .finally(() => setGuidanceLoading(false));
  }, [displayCurrency, lang]);

  // Refetch guidance when the UI language resolves/changes. loadAll() fetches once on
  // mount under the language at that moment; without this, switching to English (or the
  // hook resolving from its "tr" default) would leave the Turkish guidance on screen.
  const didInitLangRef = useRef(false);
  useEffect(() => {
    if (!didInitLangRef.current) { didInitLangRef.current = true; return; }
    reloadGuidance();
  }, [lang, reloadGuidance]);

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

  // Refetch the (server-converted) summary whenever the display currency changes.
  // The first render is skipped because loadAll() already fetches it on mount; the
  // OLD `if (!loading)` guard wrongly skipped the TRY→USD flip that getDefaultCurrency()
  // fires DURING the initial load, leaving the hero showing TRY values labelled USD.
  const didInitCcyRef = useRef(false);
  useEffect(() => {
    if (!didInitCcyRef.current) { didInitCcyRef.current = true; return; }
    void reloadSummary();
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

  // A detected credit-card statement opens the liability form prefilled — the user reviews
  // (and can add monthly payment / due date / reminder) before it becomes a tracked debt.
  const openLiabilityFromSuggestion = (s: SuggestionItem) => {
    let institution: string | undefined;
    try {
      const d = s.source_detail ? (JSON.parse(s.source_detail) as Record<string, unknown>) : {};
      institution = (d.institution as string) || (d.proposed_name as string) || undefined;
    } catch { /* ignore */ }
    setLiabPrefill({
      suggestionId: s.id,
      prefill: {
        name: institution || s.reason || "Credit card",
        liability_type: "credit_card",
        currency: s.currency,
        remaining_amount: s.suggested_change,
        fromStatement: true,
      },
    });
  };

  const handleDismissSuggestion = async (id: string) => {
    await dismissSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleRefreshPrices = async () => {
    // Single-flight: bail synchronously if any refresh (manual or auto) is in
    // flight. React's `refreshing` state is async, so the ref is the real lock.
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      const result = await refreshAssetPrices();
      // Re-fetch FX/crypto/commodity rates AND assets together, then commit both
      // in the same render. Live-value assets (crypto/FX/gold/commodity) keep
      // their quantity in current_value and are valued at display time via
      // usdRates — so their on-screen value only moves when usdRates moves. Note
      // the server caches fiat rates ~1h, so a stable price legitimately shows no
      // number change; the per-card "updated" timestamp is the proof it ran.
      const [rates, updatedAssets] = await Promise.all([
        getCurrencyRates("USD").catch(() => null),
        getAssets(),
      ]);
      if (rates) setUsdRates(rates);
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
      refreshInFlightRef.current = false;
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
    ? summary.currency_breakdown
        // Proportions use the display-currency value so every currency shares one base.
        .map((c) => ({ code: c.code, value: Math.abs(c.display_value) }))
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
          {/* Prices are refreshed automatically by the 12h scheduler — no button,
              just an honest "as of" time so the user knows these aren't live. */}
          {lastRefreshAt && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-ink-mute" title={t("nw.pricesUpdatedHint")}>
              <RefreshCw size={11} className="text-ink-mute" />
              {t("nw.pricesUpdatedPre")} {fmtTime(lastRefreshAt, lang)}{t("nw.pricesUpdatedPost")}
            </span>
          )}
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
          <div className="border border-line rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4 shadow-2xl shadow-black/30" style={{ backgroundColor: surfaceBg }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-warn" />
              <h3 className="text-ink font-semibold">{t("nw.addAlert")}</h3>
            </div>
            <p className="text-sm text-ink-mute">{alertModalAsset.name}</p>

            {!lastPrice ? (
              <div className="bg-warn/10 border border-warn/30 rounded-lg px-3 py-2.5 text-warn text-xs">
                {t("nw.toast.alertNeedsPrice")}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs bg-canvas border border-line rounded-lg px-3 py-2.5">
                  <span className="text-ink-mute">{t("nw.alertCurrentPrice")}</span>
                  <span className="text-ink-soft font-medium tabular-nums">${lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <label className="block text-xs text-ink-mute mb-2">{t("nw.alertNotifyIf")}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[10, 15, 20, 25].map((p) => (
                      <button key={p} onClick={() => setAlertPct(p)}
                        className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                          alertPct === p ? "bg-warn/20 border-warn/50 text-warn" : "bg-canvas border-line text-ink-mute hover:border-warn/50"
                        }`}>
                        −{p}%
                      </button>
                    ))}
                  </div>
                  {target !== null && (
                    <p className="text-xs text-ink-mute mt-2">
                      {t("nw.alertTriggersAt")} <span className="text-ink-soft font-medium tabular-nums">${target.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveAlert}
                disabled={alertSaving || !lastPrice}
                className="flex-1 bg-[#176B5B] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#125848] transition-colors disabled:opacity-40"
              >
                {alertSaving ? "…" : t("nw.alertSave")}
              </button>
              <button onClick={() => setAlertModalAsset(null)} className="px-4 py-2.5 rounded-lg bg-surface-2 text-ink-mute hover:text-ink-soft text-sm transition-colors">
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Hero — the centerpiece */}
      <div className="relative overflow-hidden bg-surface border border-line rounded-2xl p-8 mb-6 shadow-sm">
        {/* Soft brand wash behind the number (paints in both themes via inline gradient) */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40"
          style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(23,107,91,0.08), transparent 72%)" }}
        />
        {loading ? (
          <div className="relative space-y-3 text-center">
            <div className="h-4 w-32 bg-surface-2 rounded mx-auto animate-pulse" />
            <div className="h-14 w-72 bg-surface-2 rounded-xl mx-auto animate-pulse" />
            <div className="h-7 w-40 bg-surface-2 rounded-full mx-auto animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-surface-2 rounded-xl animate-pulse" />)}
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* Number + trend */}
            <div className="text-center">
              <p className="text-ink-mute text-xs font-medium uppercase tracking-wider mb-2">{t("nw.netWorth")}</p>
              <p className={`text-5xl sm:text-6xl font-bold tabular-nums leading-none ${netPositive ? "text-ink" : "text-neg"} ${summaryLoading ? "opacity-50" : ""}`}>
                {summary ? fmt(summary.net_worth_try, displayCurrency) : "—"}
              </p>

              {/* Trend chip — net change over the attribution window */}
              {attribution && (() => {
                const up = attribution.delta > 0;
                const flat = Math.abs(attribution.delta) < 0.5;
                const base = (summary?.net_worth_try ?? 0) - attribution.delta;
                const pct = base > 0 ? (attribution.delta / base) * 100 : null;
                return (
                  <div className="flex justify-center mt-4">
                    <span className={`inline-flex items-center gap-1.5 pl-2 pr-3 py-1 rounded-full text-sm font-semibold border ${
                      flat ? "bg-surface-2 text-ink-mute border-line"
                        : up ? "bg-pos/10 text-pos border-pos/20"
                        : "bg-neg/10 text-neg border-neg/20"
                    }`}>
                      {flat ? null : up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                      {flat
                        ? t("nw.trendFlat")
                        : <>{up ? "+" : "−"}{fmt(Math.abs(attribution.delta), displayCurrency)}{pct !== null && ` · ${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}</>}
                      <span className="text-ink-mute font-normal text-xs">· {t("nw.trendLastDays").replace("{n}", String(attribution.period_days))}</span>
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Pillars — distinct tiles */}
            <div className={`grid gap-3 mt-7 ${summary && summary.pending_receivables_try > 0 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
              <div className="rounded-xl bg-surface-2 border border-line/60 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-pos/15 flex items-center justify-center"><TrendingUp size={13} className="text-pos" /></span>
                  <span className="text-xs text-ink-mute font-medium">{t("nw.assets")}</span>
                </div>
                <p className="text-pos text-lg font-bold tabular-nums">{summary ? fmt(summary.total_assets_try, displayCurrency) : "—"}</p>
              </div>
              <div className="rounded-xl bg-surface-2 border border-line/60 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-neg/15 flex items-center justify-center"><TrendingDown size={13} className="text-neg" /></span>
                  <span className="text-xs text-ink-mute font-medium">{t("nw.liabilities")}</span>
                </div>
                <p className="text-neg text-lg font-bold tabular-nums">{summary ? fmt(summary.total_liabilities_try, displayCurrency) : "—"}</p>
              </div>
              {summary && summary.pending_receivables_try > 0 && (
                <div className="rounded-xl bg-surface-2 border border-line/60 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-6 h-6 rounded-lg bg-warn/15 flex items-center justify-center"><DollarSign size={13} className="text-warn" /></span>
                    <span className="text-xs text-ink-mute font-medium">{t("nw.receivables")}</span>
                  </div>
                  <p className="text-warn text-lg font-bold tabular-nums">{fmt(summary.pending_receivables_try, displayCurrency)}</p>
                </div>
              )}
            </div>

            {/* Why it moved — attribution drivers */}
            {attribution && attribution.drivers.length > 0 && (
              <div className="mt-5 pt-4 border-t border-line">
                <p className="text-[11px] text-ink-mute uppercase tracking-wide mb-2">{t("nw.trendWhy")}</p>
                <div className="flex items-center flex-wrap gap-1.5">
                  {attribution.drivers.map((d, i) => (
                    <span key={i} className={`inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-lg text-xs font-medium ${
                      d.direction === "up" ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"
                    }`}>
                      {d.direction === "up" ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                      <span className="text-ink-soft font-normal">{d.label}</span>
                      {d.direction === "up" ? "+" : "−"}{fmt(d.amount, displayCurrency)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Currency mix */}
            {summary && summary.currency_breakdown.length > 1 && (
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {[...summary.currency_breakdown].sort((a, b) => b.display_value - a.display_value).map((c) => (
                  <span key={c.code} className="px-2.5 py-1 rounded-full bg-surface-2 border border-line/60 text-xs text-ink-mute">
                    <span className="text-ink-soft font-medium">{c.code}</span> · {fmt(c.display_value, displayCurrency)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty state — guide first asset */}
      {!loading && assets.length === 0 && liabilities.length === 0 && receivables.length === 0 && (
        <div className="bg-surface border border-line rounded-2xl p-6 mb-6">
          <p className="text-ink font-semibold mb-1">{t("nw.empty.title")}</p>
          <p className="text-ink-mute text-sm mb-5">{t("nw.empty.subtitle")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { type: "bank_account", emoji: "💰", label: t("nw.empty.cashBank") },
              { type: "stock", emoji: "📈", label: t("nw.empty.investment") },
              { type: "real_estate", emoji: "🏠", label: t("nw.empty.realEstate") },
            ].map((c) => (
              <button
                key={c.type}
                onClick={() => { setAddAssetInitialType(c.type); setShowAddAsset(true); }}
                className="flex flex-col items-center gap-2 p-5 rounded-xl bg-canvas border border-line hover:border-brand transition-colors"
              >
                <span className="text-2xl">{c.emoji}</span>
                <span className="text-ink text-sm font-medium">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI guidance — ranked, benchmarked, action-linked findings */}
      <GuidancePanel findings={guidance} loading={guidanceLoading} paywalled={guidancePaywalled} onAction={handleGuidanceAction} t={t} />

      {/* Triggered wealth alerts */}
      {triggeredAlerts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {triggeredAlerts.map((ta) => (
            <div key={ta.alert.id} className="flex items-start gap-2 bg-danger/10 border border-neg/30 rounded-xl px-4 py-3">
              <span className="text-neg shrink-0">🔔</span>
              <div className="flex-1 min-w-0">
                <p className="text-neg text-sm font-medium">{ta.alert.message_template}</p>
                <p className="text-neg/70 text-xs mt-0.5">{ta.triggered_reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Net-worth history chart removed: it showed estimated/reconstructed data,
          which was misleading. Real trajectory lives on the Progress page once
          enough daily snapshots have accrued. */}

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
          icon={<TrendingUp size={18} className="text-pos" />}
          iconTint="bg-pos/15"
          total={summary?.total_assets_try}
          count={assets.length}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddAsset(true)}
          addLabel={t("nw.addAsset")}
          addColor="indigo"
        />
        {loading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-surface border border-line rounded-xl animate-pulse" />)}</div>
        ) : assets.length === 0 ? (
          <SectionEmpty
            icon={<TrendingUp size={22} className="text-pos" />}
            iconTint="bg-pos/15"
            title={t("nw.noAssets")}
            desc={t("nw.empty.assetsDesc")}
            ctaLabel={t("nw.addFirstAsset")}
            onCta={() => setShowAddAsset(true)}
          />
        ) : (
          <div className="space-y-3">
            {ASSET_TYPE_GROUPS.map((group) => {
              const groupAssets = assets.filter((a) => group.types.includes(a.asset_type));
              if (groupAssets.length === 0) return null;
              const groupTotal = groupAssets.reduce(
                (sum, a) => sum + (convertAmount(parseFloat(a.current_value), a.currency, displayCurrency, usdRates) ?? 0),
                0,
              );
              return (
                <div key={group.label} className="bg-surface border border-line rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-surface-2">
                    {group.icon}
                    <span className="text-xs text-ink-soft font-semibold">{group.label}</span>
                    <span className="text-[11px] text-ink-mute tabular-nums">· {groupAssets.length}</span>
                    {groupTotal > 0 && <span className="ml-auto text-xs text-ink-soft font-semibold tabular-nums">{fmt(groupTotal, displayCurrency)}</span>}
                  </div>
                  {groupAssets.map((a, idx) => {
                    const detailLabel = assetDetailLabel(a, t);
                    const priceBadge = getPriceBadge(a);
                    const maturity = a.asset_type === "bank_account" ? maturityCountdown(a.source_detail ?? null, t) : null;
                    return (
                      <div key={a.id} className={`group/row flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/60 transition-colors ${idx < groupAssets.length - 1 ? "border-b border-line" : ""}`}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-ink text-sm font-medium">{a.name}</p>
                            {priceBadge && (
                              <span title={priceBadge.title} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${priceBadge.cls}`}>{priceBadge.label}</span>
                            )}
                            {maturity && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                                maturity.days <= 0 ? "bg-warn/10 border-warn/30 text-warn"
                                  : maturity.days <= 7 ? "bg-warn/10 border-warn/30 text-warn"
                                  : "bg-surface border-line text-ink-mute"
                              }`}>{maturity.label}</span>
                            )}
                            {!AUTO_PRICE_TYPES.has(a.asset_type) && !priceBadge && (() => {
                              const d = staleDays(a.as_of_date);
                              return d !== null && d >= 90 ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-warn/10 border-warn/30 text-warn" title={t("nw.staleHint")}>
                                  {t("nw.stale")}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <p className="text-ink-mute text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{getAssetTypeLabel(a.asset_type)}</span>
                            {a.account_id && accountsMap[a.account_id] && (
                              <span className="text-brand">· {accountsMap[a.account_id]}</span>
                            )}
                            {detailLabel && <span className="text-ink-mute">· {detailLabel}</span>}
                            {a.notes && <span>· {a.notes}</span>}
                            <span className="text-ink-mute">· {SOURCE_LABELS[a.source] ?? a.source}</span>
                            {a.as_of_date && <span className="text-ink-mute">· {a.as_of_date}</span>}
                          </p>
                          {/* Honest last-price line: the per-unit price the value is
                              built from, clearly marked as not real-time. Only for
                              types where a per-unit price is meaningful (FX = $1, skip). */}
                          {PRICED_ALERT_TYPES.has(a.asset_type) && (() => {
                            const lp = assetLastPriceUsd(a);
                            if (!lp) return null;
                            return (
                              <p className="text-[11px] text-ink-mute mt-0.5">
                                {t("nw.lastPrice")}: ${lp.toLocaleString(undefined, { maximumFractionDigits: lp < 10 ? 2 : 0 })}
                                <span className="text-ink-mute"> · {t("nw.priceDelayed")}</span>
                              </p>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            {(() => {
                              const raw = parseFloat(a.current_value);
                              const converted = convertAmount(raw, a.currency, displayCurrency, usdRates);
                              const showConverted = converted !== null && a.currency.toUpperCase() !== displayCurrency.toUpperCase();
                              const nativeHint = showConverted ? fmtItem(a.current_value, a.currency) : undefined;
                              return (
                                <p
                                  title={nativeHint}
                                  className={`text-ink text-sm font-semibold tabular-nums${nativeHint ? " cursor-help" : ""}`}
                                >
                                  {showConverted ? fmt(converted!, displayCurrency) : fmtItem(a.current_value, a.currency)}
                                </p>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity">
                            {PRICED_ALERT_TYPES.has(a.asset_type) && (
                              <button
                                onClick={() => { setAlertModalAsset(a); setAlertPct(15); setAlertMessage(""); }}
                                title={t("nw.addAlert")}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-warn hover:bg-warn/10 transition-colors"
                              >
                                <Bell size={13} />
                              </button>
                            )}
                            <button onClick={() => setEditingAsset(a)} title={t("common.edit")} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-brand hover:bg-surface-3 transition-colors">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => handleDeleteAsset(a.id)} title={t("common.delete")} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-danger hover:bg-danger/10 transition-colors">
                              <X size={13} />
                            </button>
                          </div>
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
          icon={<TrendingDown size={18} className="text-neg" />}
          iconTint="bg-neg/15"
          total={summary?.total_liabilities_try}
          count={liabilities.length}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddLiability(true)}
          addLabel={t("nw.addLiability")}
          addColor="red"
        />
        {loading ? (
          <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-20 bg-surface border border-line rounded-xl animate-pulse" />)}</div>
        ) : liabilities.length === 0 ? (
          <SectionEmpty
            icon={<TrendingDown size={22} className="text-neg" />}
            iconTint="bg-neg/15"
            title={t("nw.noLiabilities")}
            desc={t("nw.empty.liabilitiesDesc")}
            ctaLabel={t("nw.addFirstLiability")}
            onCta={() => setShowAddLiability(true)}
          />
        ) : (
          <div className="space-y-3">
            {liabilities.map((l) => {
              const total = parseFloat(l.total_amount);
              const remaining = parseFloat(l.remaining_amount);
              const pct = total > 0 ? Math.min(100, ((total - remaining) / total) * 100) : 0;
              const highInterest = l.interest_rate && parseFloat(l.interest_rate) > 30;
              return (
                <div key={l.id} className="group/row bg-surface border border-line rounded-xl p-4 hover:border-line-strong transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-ink text-sm font-semibold">{l.name}</p>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-ink-mute">{getLiabilityTypeLabel(l.liability_type)}</span>
                        {highInterest && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-neg/10 text-neg border border-neg/30 font-medium">
                            %{l.interest_rate} {t("nw.highInterest").replace("% ", "")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-neg text-base font-bold tabular-nums leading-tight">{fmtItem(l.remaining_amount, l.currency)}</p>
                        <p className="text-[11px] text-ink-mute">{t("nw.remaining")}</p>
                      </div>
                      <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity">
                        <button onClick={() => setEditingLiability(l)} title={t("common.edit")} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-brand hover:bg-surface-3 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDeleteLiability(l.id)} title={t("common.delete")} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-danger hover:bg-danger/10 transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${100 - pct}%`, backgroundColor: NEG }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink-mute flex-wrap gap-x-3">
                    <span><span className="text-ink-soft font-medium tabular-nums">{Math.round(pct)}%</span> {t("nw.totalPaid").replace("%", "").trim()} · {t("nw.total")} {fmtItem(l.total_amount, l.currency)}</span>
                    <span className="flex items-center gap-3">
                      {l.monthly_payment && <span>{t("nw.monthly")}: <span className="text-ink-soft tabular-nums">{fmtItem(l.monthly_payment, l.currency)}</span></span>}
                      {l.due_date && <span>{t("nw.due")}: <span className="text-ink-soft">{l.due_date}</span></span>}
                    </span>
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
          icon={<Scale size={18} className="text-warn" />}
          iconTint="bg-warn/15"
          total={summary?.pending_receivables_try}
          count={receivables.length}
          displayCurrency={displayCurrency}
          onAdd={() => setShowAddReceivable(true)}
          addLabel={t("nw.addReceivable")}
          addColor="amber"
        />
        {loading ? (
          <div className="space-y-2"><div className="h-16 bg-surface border border-line rounded-xl animate-pulse" /></div>
        ) : receivables.length === 0 ? (
          <SectionEmpty
            icon={<Scale size={22} className="text-warn" />}
            iconTint="bg-warn/15"
            title={t("nw.noReceivables")}
            desc={t("nw.empty.receivablesDesc")}
            ctaLabel={t("nw.addFirstReceivable")}
            onCta={() => setShowAddReceivable(true)}
          />
        ) : (
          <div className="space-y-2">
            {receivables.map((r) => {
              const isOverdue = r.status === "overdue" || (r.status === "pending" && r.expected_date && r.expected_date < new Date().toISOString().slice(0, 10));
              const isReceived = r.status === "received";
              return (
                <div key={r.id} className={`group/row bg-surface border rounded-xl px-4 py-3 flex items-center justify-between gap-3 transition-colors ${isOverdue ? "border-warn/40 bg-warn/5" : isReceived ? "border-pos/30 opacity-70 hover:opacity-100" : "border-line hover:border-line-strong"}`}>
                  <div className="min-w-0 flex items-center gap-3">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isReceived ? "bg-pos/15" : isOverdue ? "bg-warn/15" : "bg-surface-2"}`}>
                      <DollarSign size={15} className={isReceived ? "text-pos" : isOverdue ? "text-warn" : "text-ink-mute"} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-ink text-sm font-semibold truncate">{r.from_person}</p>
                        {isReceived && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-pos/10 text-pos font-medium">
                            {t("nw.received")} ✓{r.linked_asset_id ? ` · ${t("nw.linkedAsset")}` : ""}
                          </span>
                        )}
                        {isOverdue && !isReceived && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/30 font-medium">{t("nw.overdue")}</span>
                        )}
                      </div>
                      <p className="text-ink-mute text-xs mt-0.5">
                        {r.expected_date && r.expected_date}
                        {r.notes && `${r.expected_date ? " · " : ""}${r.notes}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className={`text-sm font-bold tabular-nums ${isReceived ? "text-pos" : "text-ink"}`}>{fmtItem(r.amount, r.currency)}</p>
                    {!isReceived && (
                      <button onClick={() => handleMarkReceived(r.id)} className="text-xs px-2.5 py-1.5 rounded-lg bg-pos/10 text-pos border border-pos/30 hover:bg-pos/20 transition-colors font-medium whitespace-nowrap">
                        {t("nw.markReceived")}
                      </button>
                    )}
                    <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity">
                      <button onClick={() => setEditingReceivable(r)} title={t("common.edit")} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-brand hover:bg-surface-3 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDeleteReceivable(r.id)} title={t("common.delete")} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-danger hover:bg-danger/10 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
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
            <Zap size={18} className="text-warn" />
            <h2 className="text-ink font-semibold">{t("nw.suggestions")}</h2>
            <span className="px-2 py-0.5 rounded-full bg-warn/10 border border-warn/30 text-warn text-xs font-medium">
              {pendingSuggestions.length}
            </span>
          </div>
          <div className="space-y-3">
            {pendingSuggestions.map((s) => (
              <div key={s.id} className="bg-surface border border-warn/20 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-ink-soft text-sm">{s.reason}</p>
                  <p className="text-warn text-xs mt-1 font-semibold tabular-nums">
                    {parseFloat(s.suggested_change) >= 0 ? "+" : ""}{parseFloat(s.suggested_change).toLocaleString()} {s.currency}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => s.suggestion_type === "statement_liability" ? openLiabilityFromSuggestion(s) : handleAcceptSuggestion(s.id)} className="px-3 py-1.5 rounded-lg bg-[#176B5B]/10 text-[#176B5B] border border-[#176B5B]/30 hover:bg-[#176B5B]/20 text-xs font-medium transition-colors">
                    {t("nw.accept")}
                  </button>
                  <button onClick={() => handleDismissSuggestion(s.id)} className="px-3 py-1.5 rounded-lg bg-surface-2 text-ink-mute hover:text-ink-soft text-xs font-medium transition-colors">
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
          {(() => {
            const urgentCount = reconciliationItems.filter((i) => i.severity === "high").length;
            return (
          <button
            onClick={() => setActionQueueOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 mb-4 text-left group"
          >
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${urgentCount > 0 ? "bg-danger/15" : "bg-brand/10"}`}>
              <Zap size={18} className={urgentCount > 0 ? "text-danger" : "text-brand"} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-ink font-semibold leading-tight">{t("nw.actionQueue")}</h2>
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
                  urgentCount > 0 ? "bg-danger/15 text-danger"
                    : reconciliationItems.length > 0 ? "bg-brand/10 text-brand"
                    : "bg-surface-2 text-ink-mute"
                }`}>
                  {reconciliationItems.length}
                </span>
              </div>
              {urgentCount > 0 && (
                <span className="text-[11px] text-danger font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: resolved === "dark" ? "#E06666" : "#C03131" }} />
                  {urgentCount} {t("nw.recon.urgent")}
                </span>
              )}
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`ml-auto text-ink-mute transition-transform group-hover:text-ink-soft ${actionQueueOpen ? "rotate-180" : ""}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
            );
          })()}

          {actionQueueOpen && reconciliationItems.length === 0 && (
            <div className="bg-surface border border-line rounded-xl p-6 flex items-center gap-3 mb-3 text-ink-mute">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pos shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
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
                    {btn("mark_received", t("nw.markReceived"), "bg-pos/15 text-pos border border-pos/30 hover:bg-pos/25")}
                    {btn("write_off", t("nw.writeOff"), "bg-danger/10 text-neg border border-danger/30 hover:bg-danger/20")}
                    {btn("dismiss", t("common.dismiss"), "bg-surface-2 text-ink-mute hover:text-ink-soft")}
                  </>);
                } else if (item.issue_type === "received_receivable_missing_asset") {
                  actionButtons = (<>
                    {btn("create_cash_asset", t("nw.addAsset"), "bg-pos/15 text-pos border border-pos/30 hover:bg-pos/25")}
                    {btn("mark_pending", t("nw.pending"), "bg-warn/10 text-warn border border-warn/30 hover:bg-warn/20")}
                    {btn("write_off", t("nw.writeOff"), "bg-danger/10 text-neg border border-danger/30 hover:bg-danger/20")}
                  </>);
                } else if (item.issue_type === "possible_duplicate_transaction") {
                  const batchIds = (pa?.upload_batch_ids as string[] | undefined) ?? [];
                  actionButtons = (<>
                    {batchIds.length >= 2 && btn("delete_duplicate_batch", t("nw.recon.deleteOlderDuplicate"), "bg-danger/10 text-neg border border-danger/30 hover:bg-danger/20")}
                    {btn("keep_all", t("nw.recon.keepAll"), "bg-pos/15 text-pos border border-pos/30 hover:bg-pos/25")}
                    {btn("dismiss", t("common.dismiss"), "bg-surface-2 text-ink-mute hover:text-ink-soft")}
                  </>);
                } else if (item.issue_type === "large_transaction_review") {
                  actionButtons = (<>
                    {btn("confirm_category", t("common.confirm"), "bg-pos/15 text-pos border border-pos/30 hover:bg-pos/25")}
                    {btn("ignore", t("common.dismiss"), "bg-surface-2 text-ink-mute hover:text-ink-soft")}
                  </>);
                } else {
                  actionButtons = (<>
                    {btn("resolve", t("common.resolve"), "bg-pos/15 text-pos border border-pos/30 hover:bg-pos/25")}
                    {btn("dismiss", t("common.dismiss"), "bg-surface-2 text-ink-mute hover:text-ink-soft")}
                  </>);
                }

                const accent = item.severity === "high" ? "border-l-danger" : item.severity === "medium" ? "border-l-warn" : "border-l-brand";
                return (
                  <div key={item.id} className={`bg-surface border border-line border-l-4 ${accent} rounded-xl p-4`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-ink text-sm font-semibold">{itemTitle}</p>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            item.severity === "high" ? "bg-danger/10 text-danger border border-danger/30"
                              : item.severity === "medium" ? "bg-warn/10 text-warn border border-warn/30"
                              : "bg-surface-2 text-ink-mute border border-line"
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.severity === "high" ? (resolved === "dark" ? "#E06666" : "#C03131") : item.severity === "medium" ? (resolved === "dark" ? "#D9A441" : "#B0741E") : (resolved === "dark" ? "#2A9D8F" : "#0F5C5E") }} />
                            {item.severity === "high" ? t("nw.recon.urgent") : item.severity}
                          </span>
                        </div>
                        {contextLine && (
                          <p className="text-ink-soft text-xs mt-1.5 truncate">{contextLine}</p>
                        )}
                        {subtitle && (
                          <p className="text-ink-mute text-xs leading-relaxed mt-1">{subtitle}</p>
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
            <div className="bg-surface border border-line rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="text-xs text-ink-mute font-medium">{t("nw.recentEvents")}</span>
              </div>
              {events.map((event, idx) => {
                const detail = eventDetail(event.source_detail);
                return (
                  <div key={event.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${idx < events.length - 1 ? "border-b border-line" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-ink-soft text-sm">{eventLabel(event.event_type, t)}</p>
                      <p className="text-ink-mute text-xs mt-0.5">
                        {event.event_date} · {event.entity_type}{detail ? ` · ${detail}` : ""}
                      </p>
                    </div>
                    {event.amount && event.currency && (
                      <p className="text-ink-soft text-sm font-semibold tabular-nums shrink-0">{fmtItem(event.amount, event.currency)}</p>
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
        <section ref={alertsSectionRef} className="mb-8 bg-warn/5 border border-warn/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-warn/10 border border-warn/20 flex items-center justify-center">
              <Bell size={14} className="text-warn" />
            </div>
            <h2 className="text-ink font-semibold text-sm flex-1">{t("nw.wealthAlerts")}</h2>
            <span className="px-2 py-0.5 rounded-full bg-warn/10 border border-warn/30 text-warn text-xs font-medium">{wealthAlerts.length}</span>
          </div>
          <div className="space-y-2">
            {wealthAlerts.map((a) => (
              <div key={a.id} className="bg-surface border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                  <div className="min-w-0">
                    <p className="text-ink-soft text-sm truncate">{a.message_template}</p>
                    <p className="text-ink-mute text-xs mt-0.5">
                      {a.threshold_usd !== null && `${t("nw.alertTriggersAt")} $${a.threshold_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => handleDeleteAlert(a.id)} title={t("common.delete")} className="text-ink-mute hover:text-danger transition-colors text-xs px-1 shrink-0">×</button>
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
      {liabPrefill && (
        <AddLiabilityModal
          prefill={liabPrefill.prefill}
          onClose={() => setLiabPrefill(null)}
          onAdded={(liability) => {
            const sid = liabPrefill.suggestionId;
            setLiabPrefill(null);
            setLiabilities((prev) => [...prev, liability]);
            // Resolve the originating suggestion so it doesn't reappear.
            void dismissSuggestion(sid).catch(() => null);
            setSuggestions((prev) => prev.filter((s) => s.id !== sid));
            void reloadSummary();
          }}
        />
      )}
    </PageLayout>
  );
}

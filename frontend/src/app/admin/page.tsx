"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  ShieldCheck, RefreshCw, Wallet, Send, Monitor,
  CheckCircle, Sparkles, Zap, X as XIcon, TrendingUp,
} from "@/components/ui/Icons";
import { useTheme } from "@/lib/theme";
import {
  getToken, getStoredUser, setToken, setStoredUser,
  getAdminOverview, getAdminSystem, getAdminUsers,
  getAdminUserProfile, getAdminUserTransactions,
  updateAdminUser, deleteAdminUser, runAdminJob, sendAdminMessage, impersonateUser,
  type AdminOverview, type AdminSystem, type AdminUserRow,
  type AdminUserProfile, type AdminTxn,
} from "@/lib/api";

const TEAL = "#176B5B";
const PAGE = 50;

// Financial model (mirrors backend pricing + the cost assumption in the strategy doc).
const PLUS_USD = 9;          // Plus monthly list price
const PRO_USD = 19;          // Pro monthly list price
const COST_PER_ACTIVE = 0.40; // estimated cost per active user / month (LLM + infra)

// Small ⓘ with a Turkish explanation on hover — used wherever an admin metric's
// meaning isn't self-evident. Tooltip uses an explicit dark bg (the solid bg-<token>
// utilities don't paint reliably for floating elements in this build).
function InfoTip({ text, side = "top" }: { text: string; side?: "top" | "bottom" }) {
  return (
    <span className="relative inline-flex group align-middle">
      <span
        className="w-3.5 h-3.5 rounded-full border text-[9px] font-bold flex items-center justify-center cursor-help select-none leading-none"
        style={{ borderColor: "rgb(var(--c-text-muted))", color: "rgb(var(--c-text-muted))" }}
      >i</span>
      <span
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"} w-56 z-[60] opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug font-normal normal-case tracking-normal text-left shadow-xl`}
        style={{ backgroundColor: "#1C1915", color: "#F5F3EF" }}
      >
        {text}
      </span>
    </span>
  );
}

// ── format helpers ─────────────────────────────────────────────────────────────
function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}
function fmtNum(n: number): string { return new Intl.NumberFormat().format(n); }
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return iso; }
}
function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return fmtDate(iso);
  const m = Math.floor(diff / 60000);
  if (m < 60) return m <= 1 ? "now" : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}
function fmtUTC(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
  } catch { return iso; }
}

type Tab = "dashboard" | "users" | "system";

export default function AdminPage() {
  const router = useRouter();
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";

  const [tab, setTab] = useState<Tab>("dashboard");
  const [forbidden, setForbidden] = useState(false);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [system, setSystem] = useState<AdminSystem | null>(null);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);

  // guard
  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    if (!getStoredUser()?.is_admin) { router.replace("/home"); return; }
  }, [router]);

  const loadDashboard = useCallback(async () => {
    try { setOverview(await getAdminOverview()); }
    catch (e) { if (e instanceof Error && e.message === "forbidden") setForbidden(true); }
  }, []);
  const loadSystem = useCallback(async () => {
    try { setSystem(await getAdminSystem()); } catch { /* */ }
  }, []);
  const loadUsers = useCallback(async (s: string, off: number) => {
    setUsersLoading(true);
    try {
      const r = await getAdminUsers(s, PAGE, off);
      setUsers(r.users); setTotal(r.total); setOffset(off);
    } catch (e) { if (e instanceof Error && e.message === "forbidden") setForbidden(true); }
    finally { setUsersLoading(false); }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { if (tab === "users") void loadUsers(search, offset); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  useEffect(() => { if (tab === "system") void loadSystem(); }, [tab, loadSystem]);

  const openUser = useCallback(async (id: string) => {
    setSelectedId(id); setProfile(null);
    try { setProfile(await getAdminUserProfile(id)); } catch { /* */ }
  }, []);

  const refreshSelected = useCallback(async () => {
    if (selectedId) { try { setProfile(await getAdminUserProfile(selectedId)); } catch { /* */ } }
  }, [selectedId]);

  if (forbidden) {
    return (
      <PageLayout title="Command Center" maxWidth="md">
        <div className="bg-surface border border-line rounded-2xl p-10 text-center text-ink-mute">
          You don&apos;t have access to this area.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: TEAL }}>
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink leading-tight">Command Center</h1>
            <p className="text-xs text-ink-mute">Full visibility &amp; control · {overview ? `${fmtNum(overview.users_total)} users` : "…"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {system && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-surface-2 text-ink-mute font-semibold">
              {system.environment}
            </span>
          )}
          <button onClick={() => { void loadDashboard(); if (tab === "users") void loadUsers(search, offset); if (tab === "system") void loadSystem(); }}
            className="p-2 rounded-lg border border-line text-ink-mute hover:text-ink hover:border-[#176B5B]/50 transition-colors">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl border border-line p-1 mb-6 bg-surface">
        {(["dashboard", "users", "system"] as Tab[]).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${tab === tb ? "text-white" : "text-ink-mute hover:text-ink-soft"}`}
            style={tab === tb ? { backgroundColor: TEAL } : undefined}>
            {tb}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <Dashboard o={overview} />}
      {tab === "users" && (
        <Users
          users={users} total={total} offset={offset} loading={usersLoading} search={search}
          onSearch={(s) => { setSearch(s); void loadUsers(s, 0); }}
          onPage={(off) => void loadUsers(search, off)}
          onOpen={openUser}
          founderId={overview?.founder_user_id ?? null}
        />
      )}
      {tab === "system" && <System system={system} onJob={async (j) => { await runAdminJob(j); setTimeout(() => void loadSystem(), 1200); }} />}

      {/* User detail slide-over */}
      {selectedId && (
        <UserDetail
          profile={profile}
          surfaceBg={surfaceBg}
          onClose={() => { setSelectedId(null); setProfile(null); }}
          onChanged={() => { void refreshSelected(); if (tab === "users") void loadUsers(search, offset); void loadDashboard(); }}
        />
      )}
    </PageLayout>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function Dashboard({ o }: { o: AdminOverview | null }) {
  if (!o) return <SkeletonGrid />;
  const paid = o.plan_plus + o.plan_pro;
  const conv = o.users_total ? Math.round((paid / o.users_total) * 100) : 0;
  const uploadRate = o.users_total ? Math.round((o.users_with_upload / o.users_total) * 100) : 0;
  const onboardedRate = o.users_total ? Math.round((o.users_onboarded / o.users_total) * 100) : 0;
  const chart = o.signups_30d.map((p) => ({ d: p.date.slice(5), v: p.count }));

  return (
    <div className="space-y-4">
      {/* Revenue & cost — the financial picture */}
      <Financials o={o} />

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] uppercase tracking-wider text-ink-mute font-semibold">Operations</span>
        <span className="flex-1 h-px bg-line" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total users" value={fmtNum(o.users_total)} sub={`+${o.users_new_7d} this week`} icon={<ShieldCheck size={16} />} />
        <Kpi label="Paid users" value={fmtNum(paid)} sub={`${conv}% conversion`} icon={<Sparkles size={16} />} accent
          tip="Plus + Pro abone sayısı. Dönüşüm = ücretli / toplam kullanıcı." />
        <Kpi label="MRR potential" value={fmtUsd(o.mrr_potential_usd)} sub={`${o.plan_plus} Plus · ${o.plan_pro} Pro`} icon={<Wallet size={16} />} accent
          tip="Aylık Tekrarlayan Gelir tahmini: ücretli kullanıcı × plan fiyatı (Plus $9, Pro $19). Herkesin aboneliğini sürdürdüğünü varsayar." />
        <Kpi label="Active (7d)" value={fmtNum(o.active_7d)} sub={`${fmtNum(o.active_30d)} in 30d`} icon={<Zap size={16} />}
          tip="Son 7 (ve 30) günde uygulamada işlem yapan kullanıcı sayısı." />
      </div>

      <Card title="Signups · last 30 days" subtitle={`${o.users_new_30d} new accounts`}>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="adminSignups" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" vertical={false} />
              <XAxis dataKey="d" tick={{ fill: "rgb(var(--c-text-muted))", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis allowDecimals={false} tick={{ fill: "rgb(var(--c-text-muted))", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={{ backgroundColor: "rgb(var(--c-surface))", border: "1px solid rgb(var(--c-line))", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="v" stroke={TEAL} strokeWidth={2} fill="url(#adminSignups)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Plan mix" subtitle="Free vs paid">
          <PlanBar free={o.plan_free} plus={o.plan_plus} pro={o.plan_pro} />
          <div className="grid grid-cols-3 gap-2 mt-4">
            <MiniStat label="Free" value={fmtNum(o.plan_free)} dot="bg-ink-mute" />
            <MiniStat label="Plus" value={fmtNum(o.plan_plus)} dot="bg-[#176B5B]" />
            <MiniStat label="Pro" value={fmtNum(o.plan_pro)} dot="bg-amber-500" />
          </div>
        </Card>

        <Card title="Engagement" subtitle="How much the product is used">
          <div className="space-y-3 pt-1">
            <Meter label="Onboarded" pct={onboardedRate} caption={`${fmtNum(o.users_onboarded)} / ${fmtNum(o.users_total)}`}
              tip="Kayıt sonrası karşılama akışını tamamlayan kullanıcıların oranı." />
            <Meter label="Uploaded a statement" pct={uploadRate} caption={`${fmtNum(o.users_with_upload)} users`}
              tip="En az bir ekstre yüklemiş kullanıcıların oranı. Ürünün ana 'aha' anı." />
            <Meter label="Active last 7 days" pct={o.users_total ? Math.round((o.active_7d / o.users_total) * 100) : 0} caption={`${fmtNum(o.active_7d)} users`}
              tip="Son 7 günde aktif olan kullanıcıların toplam kullanıcıya oranı." />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-line">
            <MiniStat label="Transactions" value={fmtNum(o.transactions_total)} />
            <MiniStat label="Statements" value={fmtNum(o.upload_batches)} tip="Yüklenen toplam ekstre (işlem grubu) sayısı." />
            <MiniStat label="Open items" value={fmtNum(o.reconciliation_open)} tip="Çözülmemiş mutabakat kalemleri: mükerrer kayıt, eksik varlık, vadesi geçmiş alacak gibi sistemin işaretlediği konular." />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Revenue & cost (site-wide financials, computed client-side from overview) ──
function Financials({ o }: { o: AdminOverview }) {
  // What-if: share of free users that upgrade (to Plus, the conservative baseline).
  const [convPct, setConvPct] = useState(5);

  const paid = o.plan_plus + o.plan_pro;
  const mrr = o.mrr_potential_usd;
  const cost = o.active_30d * COST_PER_ACTIVE;
  const profit = mrr - cost;
  const margin = mrr > 0 ? Math.round((profit / mrr) * 100) : null;

  const pctOf = (n: number) => (o.users_total ? (n / o.users_total) * 100 : 0);
  const paidConv = pctOf(paid);

  const addlMrr = o.plan_free * (convPct / 100) * PLUS_USD;
  const projMrr = mrr + addlMrr;
  // Converting already-active free users adds little marginal cost → hold cost flat.
  const projMargin = projMrr > 0 ? Math.round(((projMrr - cost) / projMrr) * 100) : null;

  const PRESETS = [1, 3, 5, 10, 20];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-ink-mute font-semibold">Revenue &amp; cost</span>
        <span className="flex-1 h-px bg-line" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="MRR" value={fmtUsd(mrr)} sub={`${fmtNum(paid)} paying`} icon={<Wallet size={16} />} accent
          tip="Aylık Tekrarlayan Gelir tahmini: Plus ($9) ve Pro ($19) abone sayısı × fiyat. Herkesin aboneliğini sürdürdüğünü varsayar." />
        <Kpi label="Est. cost / mo" value={fmtUsd(cost)} sub={`${fmtNum(o.active_30d)} active × $${COST_PER_ACTIVE.toFixed(2)}`} icon={<Zap size={16} />}
          tip="Tahmini aylık maliyet: son 30 günde aktif kullanıcı sayısı × kullanıcı başına ~$0,40 (LLM + altyapı)." />
        <Kpi label="Gross margin" value={margin === null ? "—" : `${margin}%`} sub={mrr > 0 ? `${fmtUsd(profit)} profit` : "no revenue yet"} icon={<TrendingUp size={16} />} accent
          tip="Brüt kâr marjı = (Gelir − Maliyet) / Gelir. Gelirin maliyetten ne kadar fazla olduğunu gösterir; yüksek olması iyidir." />
        <Kpi label="Paid conversion" value={`${paidConv.toFixed(1)}%`} sub={`${fmtNum(paid)} / ${fmtNum(o.users_total)}`} icon={<Sparkles size={16} />}
          tip="Dönüşüm oranı = ücretli kullanıcı / toplam kullanıcı. Ücretsizden ücretliye geçiş başarısının ölçüsü." />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversion breakdown */}
        <Card title="Plan conversion" subtitle="Free → paid"
          tip="Her planın kullanıcı sayısı ve toplam içindeki payı. Plus/Pro oranları dönüşümün nereye gittiğini gösterir.">
          <PlanBar free={o.plan_free} plus={o.plan_plus} pro={o.plan_pro} />
          <div className="space-y-2 mt-4">
            <ConvRow dot="bg-ink-mute" label="Free" count={o.plan_free} pct={pctOf(o.plan_free)} />
            <ConvRow dot="bg-[#176B5B]" label="Plus" count={o.plan_plus} pct={pctOf(o.plan_plus)}
              tip="Toplam kullanıcının yüzde kaçı Plus'a geçti." />
            <ConvRow dot="bg-amber-500" label="Pro" count={o.plan_pro} pct={pctOf(o.plan_pro)}
              tip="Toplam kullanıcının yüzde kaçı Pro'ya geçti." />
          </div>
          <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-xs">
            <span className="text-ink-soft inline-flex items-center gap-1">
              Paid overall
              <InfoTip text="Ücretli (Plus + Pro) kullanıcıların toplam kullanıcıya oranı." />
            </span>
            <span className="text-ink font-semibold tabular-nums">{paidConv.toFixed(1)}%</span>
          </div>
        </Card>

        {/* Revenue potential what-if */}
        <Card title="Revenue potential" subtitle="If free users upgraded"
          tip="Ücretsiz kullanıcıların seçili yüzdesi Plus'a ($9/ay) geçerse aylık gelire eklenecek tutar. Senaryo aracı.">
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setConvPct(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${convPct === p ? "text-white border-transparent" : "border-line text-ink-soft hover:border-[#176B5B]/50"}`}
                style={convPct === p ? { backgroundColor: TEAL } : undefined}>
                {p}%
              </button>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-mute">
              Added MRR if {convPct}% of {fmtNum(o.plan_free)} free upgrade
            </p>
            <p className="text-3xl font-bold tabular-nums leading-none mt-1" style={{ color: TEAL }}>
              +{fmtUsd(addlMrr)}<span className="text-sm text-ink-mute font-medium"> /mo</span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <MiniStat label="Projected MRR" value={fmtUsd(projMrr)}
              tip="Mevcut MRR + bu senaryodan gelecek ek gelir." />
            <MiniStat label="Projected margin" value={projMargin === null ? "—" : `${projMargin}%`}
              tip="Senaryo gerçekleşirse brüt kâr marjı (maliyet sabit varsayılır)." />
          </div>
          <p className="text-[10px] text-ink-mute mt-2">Plus geçişi varsayar ($9/ay). Gerçek karışım daha yüksek olabilir.</p>
        </Card>
      </div>
    </div>
  );
}

function ConvRow({ dot, label, count, pct, tip }: { dot: string; label: string; count: number; pct: number; tip?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="inline-flex items-center gap-1.5 text-ink-soft">
        <span className={`w-2 h-2 rounded-full ${dot}`} />{label}{tip && <InfoTip text={tip} />}
      </span>
      <span className="text-ink-mute tabular-nums">{fmtNum(count)} · {pct.toFixed(1)}%</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════════════════
function Users({ users, total, offset, loading, search, onSearch, onPage, onOpen, founderId }: {
  users: AdminUserRow[]; total: number; offset: number; loading: boolean; search: string;
  onSearch: (s: string) => void; onPage: (off: number) => void; onOpen: (id: string) => void; founderId: string | null;
}) {
  const [q, setQ] = useState(search);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); onSearch(q.trim()); }} className="flex-1 min-w-[220px]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email…"
            className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20" />
        </form>
        <span className="text-xs text-ink-mute">{fmtNum(total)} users</span>
      </div>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-mute border-b border-line">
                <th className="px-4 py-2.5 font-semibold">User</th>
                <th className="px-3 py-2.5 font-semibold">Plan</th>
                <th className="px-3 py-2.5 font-semibold">Joined</th>
                <th className="px-3 py-2.5 font-semibold">Active</th>
                <th className="px-3 py-2.5 font-semibold text-right">Net worth</th>
                <th className="px-3 py-2.5 font-semibold text-right">Assets</th>
                <th className="px-3 py-2.5 font-semibold text-right">Debts</th>
                <th className="px-3 py-2.5 font-semibold text-right">Stmts</th>
                <th className="px-3 py-2.5 font-semibold text-right">Msgs</th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-ink-mute">Loading…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-ink-mute">No users found.</td></tr>
              )}
              {users.map((u) => (
                <tr key={u.id} onClick={() => onOpen(u.id)}
                  className="border-b border-line last:border-0 hover:bg-surface-2/50 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-full text-white text-xs font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL }}>
                        {u.email[0]?.toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-ink truncate max-w-[200px]">{u.email}</span>
                          {u.email_verified
                            ? <CheckCircle size={13} className="text-pos shrink-0" />
                            : <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="unverified" />}
                          {u.id === founderId && <span className="text-[9px] uppercase px-1 rounded bg-amber-500/15 text-amber-600 font-bold shrink-0">Founder</span>}
                          {u.is_admin && u.id !== founderId && <span className="text-[9px] uppercase px-1 rounded bg-[#176B5B]/15 text-[#176B5B] font-bold shrink-0">Admin</span>}
                        </div>
                        <span className="text-[11px] text-ink-mute">{u.transaction_count} txns · {u.asset_count} assets</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><PlanBadge plan={u.plan} /></td>
                  <td className="px-3 py-3 text-ink-mute text-xs whitespace-nowrap">{fmtDate(u.created_at)}</td>
                  <td className="px-3 py-3 text-ink-mute text-xs">{relTime(u.last_activity)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink font-medium">{fmtUsd(u.net_worth_usd)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-pos">{fmtUsd(u.assets_usd)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-neg">{fmtUsd(u.liabilities_usd)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-mute">{u.statement_count}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-mute">{u.message_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-xs text-ink-mute">
          <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {fmtNum(total)}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE))}
              className="px-3 py-1.5 rounded-lg border border-line disabled:opacity-40 hover:border-[#176B5B]/50 transition-colors">Prev</button>
            <button disabled={offset + PAGE >= total} onClick={() => onPage(offset + PAGE)}
              className="px-3 py-1.5 rounded-lg border border-line disabled:opacity-40 hover:border-[#176B5B]/50 transition-colors">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// USER DETAIL (slide-over)
// ════════════════════════════════════════════════════════════════════════════
function UserDetail({ profile, surfaceBg, onClose, onChanged }: {
  profile: AdminUserProfile | null; surfaceBg: string; onClose: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgTitle, setMsgTitle] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [txns, setTxns] = useState<AdminTxn[] | null>(null);
  const [txnTotal, setTxnTotal] = useState(0);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800); };

  const p = profile;
  const setPlan = async (plan: string) => {
    if (!p || busy) return; setBusy(true);
    try { await updateAdminUser(p.id, { plan }); flash(`Plan → ${plan}`); onChanged(); } catch { flash("Failed"); } finally { setBusy(false); }
  };
  const toggleVerify = async () => {
    if (!p || busy) return; setBusy(true);
    try { await updateAdminUser(p.id, { email_verified: !p.email_verified }); flash(p.email_verified ? "Unverified" : "Verified"); onChanged(); } catch { flash("Failed"); } finally { setBusy(false); }
  };
  const doImpersonate = async () => {
    if (!p) return;
    if (!confirm(`View the app as ${p.email}?\n\nYou'll be signed in as this user. Log out and sign back in to return to your admin account.`)) return;
    try {
      const res = await impersonateUser(p.id);
      const adminTok = getToken();
      if (adminTok) localStorage.setItem("mizan_admin_token", adminTok);
      setToken(res.access_token);
      setStoredUser({
        id: p.id, email: p.email, onboarding_completed: p.onboarding_completed,
        language: p.language, display_currency: p.display_currency, plan: p.plan,
        is_admin: false, email_verified: p.email_verified,
        display_name: p.full_name ?? undefined,
        account_type: (p.account_type as "personal" | "business") ?? "personal",
      });
      window.location.href = "/home";
    } catch { flash("Failed"); }
  };
  const sendMsg = async () => {
    if (!p || !msgBody.trim() || busy) return; setBusy(true);
    try { await sendAdminMessage(p.id, msgTitle.trim() || "Message", msgBody.trim()); setMsgOpen(false); setMsgTitle(""); setMsgBody(""); flash("Message sent"); } catch { flash("Failed"); } finally { setBusy(false); }
  };
  const softDelete = async () => {
    if (!p || busy) return;
    if (!confirm(`Soft-delete ${p.email}? They can no longer log in; data is kept and the action is logged.`)) return;
    setBusy(true);
    try { await deleteAdminUser(p.id, false); flash("Deleted"); onChanged(); onClose(); } catch { flash("Failed"); } finally { setBusy(false); }
  };
  const loadTxns = useCallback(async () => {
    if (!p) return;
    try { const r = await getAdminUserTransactions(p.id, 50, 0); setTxns(r.transactions); setTxnTotal(r.total); } catch { /* */ }
  }, [p]);

  const nwChart = (p?.networth_history ?? []).map((x) => ({ d: x.date.slice(5), v: Math.round(x.net_worth_usd) }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-3xl h-full overflow-y-auto border-l border-line shadow-2xl" style={{ backgroundColor: surfaceBg }} onClick={(e) => e.stopPropagation()}>
        {toast && (
          <div className="fixed top-5 right-6 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs shadow-lg" style={{ backgroundColor: TEAL }}>
            <CheckCircle size={13} /> {toast}
          </div>
        )}

        {!p ? (
          <div className="p-10 text-center text-ink-mute">Loading…</div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-12 h-12 rounded-full text-white text-lg font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL }}>
                  {(p.full_name?.[0] ?? p.email[0])?.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-ink font-semibold truncate">{p.full_name || p.email}</h2>
                    {p.is_founder && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-bold">Founder</span>}
                    {p.is_admin && !p.is_founder && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#176B5B]/15 text-[#176B5B] font-bold">Admin</span>}
                  </div>
                  <p className="text-ink-mute text-xs truncate">{p.email}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors"><XIcon size={18} /></button>
            </div>

            {/* Status chips */}
            <div className="flex flex-wrap gap-2">
              <PlanBadge plan={p.plan} />
              <Chip tone={p.email_verified ? "pos" : "warn"}>{p.email_verified ? "Verified" : "Unverified"}</Chip>
              <Chip tone={p.onboarding_completed ? "pos" : "mute"}>{p.onboarding_completed ? "Onboarded" : "Not onboarded"}</Chip>
              <Chip tone="mute">{p.account_type}</Chip>
              <Chip tone="mute">{p.display_currency} · {p.language.toUpperCase()}</Chip>
              {p.health?.score != null && <Chip tone="brand">Health {p.health.score}</Chip>}
              {p.health?.score != null && <InfoTip text="Finansal sağlık skoru (0–100): tasarruf oranı, borç yükü, harcama disiplini ve net değer büyümesinden hesaplanır." />}
            </div>

            {/* Actions */}
            <div className="rounded-xl border border-line p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide text-ink-mute mr-1">Plan</span>
                {["free", "plus", "pro"].map((pl) => (
                  <button key={pl} disabled={busy} onClick={() => setPlan(pl)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${p.plan === pl ? "text-white border-transparent" : "border-line text-ink-soft hover:border-[#176B5B]/50"}`}
                    style={p.plan === pl ? { backgroundColor: TEAL } : undefined}>{pl}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <ActBtn onClick={toggleVerify} busy={busy} icon={<CheckCircle size={13} />}>{p.email_verified ? "Unverify" : "Verify email"}</ActBtn>
                <ActBtn onClick={() => setMsgOpen((v) => !v)} icon={<Send size={13} />}>Message</ActBtn>
                <ActBtn onClick={doImpersonate} icon={<Monitor size={13} />}>View as user</ActBtn>
                <InfoTip text="Bu kullanıcı olarak uygulamaya giriş yap (impersonate). Kendi admin hesabına dönmek için çıkış yapıp tekrar giriş yap." />
                <ActBtn onClick={softDelete} busy={busy} danger icon={<XIcon size={13} />}>Delete</ActBtn>
                <InfoTip text="Yumuşak silme: kullanıcı artık giriş yapamaz ama verisi saklanır ve işlem denetim kaydına yazılır. Kalıcı silme değildir." />
              </div>
              {msgOpen && (
                <div className="space-y-2 pt-1">
                  <input value={msgTitle} onChange={(e) => setMsgTitle(e.target.value)} placeholder="Title"
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B]" />
                  <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} placeholder="Write a message that lands in their notifications…" rows={3}
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] resize-none" />
                  <button disabled={busy || !msgBody.trim()} onClick={sendMsg}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: TEAL }}>Send</button>
                </div>
              )}
            </div>

            {/* Snapshot KPIs */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <MiniStat label="Net worth" value={fmtUsd(p.networth_history.at(-1)?.net_worth_usd ?? null)} />
              <MiniStat label="Assets" value={fmtNum(p.asset_count)} />
              <MiniStat label="Debts" value={fmtNum(p.liability_count)} />
              <MiniStat label="Txns" value={fmtNum(p.transaction_count)} />
              <MiniStat label="Stmts" value={fmtNum(p.upload_batches)} />
              <MiniStat label="Msgs" value={fmtNum(p.message_count)} />
            </div>

            {/* Net worth history */}
            {nwChart.length >= 2 && (
              <Card title="Net worth (USD)" subtitle={`${nwChart.length} snapshots · last active ${relTime(p.last_activity)}`}>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={nwChart} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" vertical={false} />
                      <XAxis dataKey="d" tick={{ fill: "rgb(var(--c-text-muted))", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis tick={{ fill: "rgb(var(--c-text-muted))", fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => fmtUsd(v)} />
                      <Tooltip contentStyle={{ backgroundColor: "rgb(var(--c-surface))", border: "1px solid rgb(var(--c-line))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [fmtUsd(v), "Net worth"]} />
                      <Line type="monotone" dataKey="v" stroke={TEAL} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* Business identity */}
            {p.account_type === "business" && (p.company_name || p.industry || p.team_size) && (
              <Card title="Business">
                <DefList rows={[["Company", p.company_name], ["Industry", p.industry], ["Team size", p.team_size], ["Phone", p.phone], ["Country", p.country]]} />
              </Card>
            )}

            {/* Financial life */}
            {p.assets.length > 0 && (
              <MiniTable title="Assets" cols={["Name", "Type", "Value"]} rows={p.assets.map((a) => [a.name, a.asset_type, `${a.current_value} ${a.currency}`])} />
            )}
            {p.liabilities.length > 0 && (
              <MiniTable title="Liabilities" cols={["Name", "Type", "Owed"]} rows={p.liabilities.map((l) => [l.name, l.liability_type, `${l.remaining_amount} ${l.currency}`])} />
            )}
            {p.receivables.length > 0 && (
              <MiniTable title="Receivables" cols={["From", "Status", "Amount"]} rows={p.receivables.map((r) => [r.from_person, r.status, `${r.amount} ${r.currency}`])} />
            )}
            {p.statements.length > 0 && (
              <MiniTable title="Statements uploaded" cols={["Uploaded", "Count", "Period"]} rows={p.statements.map((s) => [fmtDate(s.uploaded_at), `${s.transaction_count} txns`, `${s.min_date.slice(0, 10)} → ${s.max_date.slice(0, 10)}`])} />
            )}

            {/* Plan history */}
            {p.plan_history.length > 0 && (
              <Card title="Plan history">
                <div className="space-y-1.5 pt-1">
                  {p.plan_history.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-ink-soft">{h.old_plan ?? "?"} → <span className="font-semibold">{h.new_plan ?? "?"}</span></span>
                      <span className="text-ink-mute">{fmtDate(h.at)} · {h.admin_email}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Transactions (lazy) */}
            <Card title="Transactions" subtitle={`${fmtNum(p.transaction_count)} total`}>
              {txns === null ? (
                <button onClick={() => void loadTxns()} className="text-sm text-[#176B5B] font-medium hover:underline">Load recent transactions →</button>
              ) : txns.length === 0 ? (
                <p className="text-ink-mute text-sm">No transactions.</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs">
                    <tbody>
                      {txns.map((t) => (
                        <tr key={t.id} className="border-b border-line last:border-0">
                          <td className="py-1.5 pr-2 text-ink-mute whitespace-nowrap">{t.transaction_date.slice(0, 10)}</td>
                          <td className="py-1.5 pr-2 text-ink truncate max-w-[260px]">{t.description}</td>
                          <td className={`py-1.5 text-right tabular-nums ${t.transaction_type === "credit" ? "text-pos" : "text-neg"}`}>
                            {t.transaction_type === "credit" ? "+" : "−"}{t.amount} {t.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {txnTotal > txns.length && <p className="text-[11px] text-ink-mute mt-2">Showing {txns.length} of {fmtNum(txnTotal)}</p>}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM
// ════════════════════════════════════════════════════════════════════════════
function System({ system, onJob }: { system: AdminSystem | null; onJob: (j: string) => Promise<void>; }) {
  const [running, setRunning] = useState<string | null>(null);
  if (!system) return <SkeletonGrid />;
  const keys: [string, boolean][] = [
    ["DeepSeek", system.config.deepseek_api_key],
    ["OpenAI", system.config.openai_api_key],
    ["Resend", system.config.resend_api_key],
    ["LLM configured", system.config.llm_configured],
  ];
  const jobs = [
    { key: "reconciliation", label: "Reconciliation scan", tip: "Tutarsızlıkları (mükerrer kayıt, eksik varlık, vadesi geçmiş alacak) tarayan arka plan işi. Normalde 6 saatte bir çalışır." },
    { key: "daily_notifications", label: "Daily notifications", tip: "Kullanıcılara günlük bildirimleri üreten iş (yaklaşan ödeme, bütçe uyarısı, günlük analiz). Her gün 09:00 UTC." },
    { key: "price_refresh", label: "Asset price refresh", tip: "Kripto, altın, döviz ve hisse gibi varlıkların güncel fiyatlarını çeken iş. 12 saatte bir." },
    { key: "email_briefs", label: "Weekly email briefs", tip: "Haftalık para özeti e-postasını gönderen iş. Pazar 09:00 UTC." },
  ];
  const next = system.scheduler.jobs || {};
  const last = system.scheduler.last_run || {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="API keys & config" subtitle={`Environment: ${system.environment}`}
        tip="Sunucudaki entegrasyonların yapılandırılıp yapılandırılmadığı. 'Missing' olan bir anahtar o özelliğin (ör. AI, e-posta) çalışmadığı anlamına gelir.">{/* keys */}
        <div className="space-y-2.5 pt-1">
          {keys.map(([label, ok]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-sm text-ink-soft">{label}</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${ok ? "text-pos" : "text-neg"}`}>
                <span className={`w-2 h-2 rounded-full ${ok ? "bg-pos" : "bg-neg"}`} />{ok ? "Configured" : "Missing"}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-line">
            <span className="text-sm text-ink-soft">Frontend URL</span>
            <span className="text-xs text-ink-mute truncate max-w-[200px]">{system.config.frontend_url || "—"}</span>
          </div>
        </div>
      </Card>

      <Card title="Scheduler & jobs" subtitle={system.scheduler.running ? "Running" : "Stopped"}
        tip="Otomatik arka plan işleri. 'Run now' ile bir işi hemen elle çalıştırabilirsin; aksi halde programına göre çalışır.">{/* jobs */}
        <div className="space-y-2 pt-1">
          {jobs.map((j) => (
            <div key={j.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-line last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate inline-flex items-center gap-1.5">{j.label}<InfoTip text={j.tip} /></p>
                <p className="text-[11px] text-ink-mute">Next: {fmtUTC(next[j.key]?.next_run ?? null)} · Last: {fmtUTC(last[j.key] ?? null)}</p>
              </div>
              <button disabled={running === j.key} onClick={async () => { setRunning(j.key); await onJob(j.key); setTimeout(() => setRunning(null), 1400); }}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-soft hover:border-[#176B5B]/50 transition-colors disabled:opacity-50">
                <Zap size={12} />{running === j.key ? "…" : "Run now"}
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────
function Card({ title, subtitle, children, tip }: { title: string; subtitle?: string; children: ReactNode; tip?: string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">{title}{tip && <InfoTip text={tip} />}</h3>
        {subtitle && <p className="text-xs text-ink-mute mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, icon, accent, tip }: { label: string; value: string; sub: string; icon: ReactNode; accent?: boolean; tip?: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-[#176B5B]/30 bg-[#176B5B]/[0.05]" : "border-line bg-surface"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-mute inline-flex items-center gap-1">{label}{tip && <InfoTip text={tip} />}</span>
        <span className={accent ? "text-[#176B5B]" : "text-ink-mute"}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-ink tabular-nums leading-none">{value}</p>
      <p className="text-[11px] text-ink-mute mt-1.5">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value, dot, tip }: { label: string; value: string; dot?: string; tip?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
        <span className="text-[10px] uppercase tracking-wide text-ink-mute truncate">{label}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      <p className="text-sm font-semibold text-ink tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function Meter({ label, pct, caption, tip }: { label: string; pct: number; caption: string; tip?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-ink-soft inline-flex items-center gap-1">{label}{tip && <InfoTip text={tip} />}</span>
        <span className="text-ink-mute tabular-nums">{pct}% · {caption}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: TEAL }} />
      </div>
    </div>
  );
}

function PlanBar({ free, plus, pro }: { free: number; plus: number; pro: number }) {
  const total = Math.max(1, free + plus + pro);
  return (
    <div className="h-3 rounded-full overflow-hidden flex bg-surface-2">
      <div style={{ width: `${(free / total) * 100}%`, backgroundColor: "rgb(var(--c-text-muted))" }} />
      <div style={{ width: `${(plus / total) * 100}%`, backgroundColor: TEAL }} />
      <div style={{ width: `${(pro / total) * 100}%`, backgroundColor: "#F59E0B" }} />
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, string> = {
    free: "text-ink-mute bg-surface-2",
    plus: "text-[#176B5B] bg-[#176B5B]/10",
    pro: "text-amber-600 bg-amber-500/15",
  };
  return <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${map[plan] ?? map.free}`}>{plan}</span>;
}

function Chip({ children, tone }: { children: ReactNode; tone: "pos" | "warn" | "mute" | "brand" }) {
  const map = { pos: "bg-pos/10 text-pos", warn: "bg-warn/10 text-warn", mute: "bg-surface-2 text-ink-mute", brand: "bg-[#176B5B]/10 text-[#176B5B]" };
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${map[tone]}`}>{children}</span>;
}

function ActBtn({ children, onClick, icon, danger, busy }: { children: ReactNode; onClick: () => void; icon: ReactNode; danger?: boolean; busy?: boolean }) {
  return (
    <button disabled={busy} onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${danger ? "border-line text-ink-soft hover:text-danger hover:border-danger/40" : "border-line text-ink-soft hover:text-ink hover:border-[#176B5B]/50"}`}>
      {icon}{children}
    </button>
  );
}

function DefList({ rows }: { rows: [string, string | null][] }) {
  return (
    <div className="space-y-1.5 pt-1">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between text-xs">
          <span className="text-ink-mute">{k}</span>
          <span className="text-ink-soft font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

function MiniTable({ title, cols, rows }: { title: string; cols: string[]; rows: (string | null)[][] }) {
  return (
    <Card title={title} subtitle={`${rows.length} ${rows.length === 1 ? "item" : "items"}`}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-ink-mute border-b border-line">
              {cols.map((c, i) => <th key={c} className={`py-1.5 px-1 font-semibold ${i === cols.length - 1 ? "text-right" : ""}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((r, ri) => (
              <tr key={ri} className="border-b border-line last:border-0">
                {r.map((cell, ci) => (
                  <td key={ci} className={`py-1.5 px-1 ${ci === r.length - 1 ? "text-right tabular-nums text-ink font-medium whitespace-nowrap" : "text-ink-soft truncate max-w-[180px]"}`}>{cell || "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 rounded-2xl bg-surface-2 animate-pulse" />)}
    </div>
  );
}

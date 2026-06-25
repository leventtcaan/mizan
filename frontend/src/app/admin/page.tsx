"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import {
  ShieldCheck, RefreshCw, TrendingUp, TrendingDown, Wallet, Scale, Bell, Zap,
  X as XIcon, FileText, Calendar, Target, ArrowRight,
} from "@/components/ui/Icons";
import { CATEGORY_LABELS } from "@/lib/categories";
import {
  getToken, getStoredUser,
  getAdminOverview, getAdminSystem, getAdminUsers,
  getAdminUserProfile, getAdminUserTransactions,
  updateAdminUser, deleteAdminUser, runAdminJob,
  type AdminOverview, type AdminSystem, type AdminUserRow,
  type AdminUserProfile, type AdminTxn,
} from "@/lib/api";

// ── format helpers ─────────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return iso; }
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}
// Scheduler runs on UTC cron — render its instants explicitly in UTC with a label so
// the "next run" date is correct and unambiguous regardless of the admin's timezone.
function fmtDateTimeUTC(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
    }) + " UTC";
  } catch { return iso; }
}
function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}
function num(n: number): string { return new Intl.NumberFormat(undefined).format(n); }
function money(v: string, ccy: string): string {
  const n = parseFloat(v);
  if (!isFinite(n)) return `${v} ${ccy}`;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n); }
  catch { return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)} ${ccy}`; }
}
function slug(s: string): string { return s.replace(/_/g, " "); }

const PAGE_SIZE = 25;
const TX_PAGE = 25;

const BAND_COLOR: Record<string, string> = {
  strong: "text-emerald-400", steady: "text-brand", fragile: "text-amber-400", at_risk: "text-neg",
};

const JOBS: { key: string; label: string; schedJobId: string }[] = [
  { key: "reconciliation", label: "Reconciliation scan", schedJobId: "reconciliation_all_users" },
  { key: "daily_notifications", label: "Daily notifications", schedJobId: "daily_notifications_all_users" },
  { key: "price_refresh", label: "Price refresh + snapshot", schedJobId: "price_refresh_all_users" },
  { key: "email_briefs", label: "Weekly email briefs", schedJobId: "email_briefs_all_users" },
];

// ── small UI atoms ──────────────────────────────────────────────────────────────
function Metric({ label, value, sub, icon, accent = "text-ink" }: {
  label: string; value: string; sub?: string; icon?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-xl bg-surface border border-line p-4">
      <div className="flex items-center gap-1.5 text-ink-mute text-[11px] uppercase tracking-wide mb-2">{icon}{label}</div>
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="text-ink-mute text-xs mt-1">{sub}</p>}
    </div>
  );
}
function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
      ok ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300" : "bg-red-950/30 border-red-800/40 text-red-300"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />{label}
    </span>
  );
}
function Badge({ tone, children }: { tone: "founder" | "admin" | "ok" | "muted"; children: React.ReactNode }) {
  const cls = {
    founder: "bg-amber-950/40 text-amber-300 border-amber-800/50",
    admin: "bg-brand/40 text-brand border-brand/50",
    ok: "bg-emerald-950/30 text-emerald-300 border-emerald-800/40",
    muted: "bg-surface text-ink-mute border-line",
  }[tone];
  return <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{children}</span>;
}

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // users list
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);

  // profile view
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [txns, setTxns] = useState<AdminTxn[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(false);

  // mutations + jobs
  const [busy, setBusy] = useState(false);
  const [jobMsg, setJobMsg] = useState<Record<string, string>>({});

  // delete confirmation (typed email)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const meId = getStoredUser()?.id ?? "";
  const founderId = overview?.founder_user_id ?? null;

  const loadOverview = useCallback(() => {
    getAdminOverview().then(setOverview).catch((e) => {
      if (e instanceof Error && e.message === "forbidden") router.replace("/home");
    });
  }, [router]);
  const loadSystem = useCallback(() => { getAdminSystem().then(setSystem).catch(() => {}); }, []);
  const loadUsers = useCallback((term: string, off: number) => {
    setUsersLoading(true);
    getAdminUsers(term, PAGE_SIZE, off)
      .then((res) => { setUsers(res.users); setUsersTotal(res.total); })
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, []);

  // auth gate — server is source of truth (403 → home)
  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    Promise.all([getAdminOverview(), getAdminSystem()])
      .then(([o, s]) => { setOverview(o); setSystem(s); setAuthorized(true); loadUsers("", 0); })
      .catch((e) => {
        if (e instanceof Error && e.message === "forbidden") { router.replace("/home"); return; }
        setAuthorized(true); setError("Couldn't load admin data.");
      });
  }, [router, loadUsers]);

  // debounced search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (authorized !== true) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setOffset(0); loadUsers(search, 0); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, authorized, loadUsers]);

  // ── profile open / load ──
  const loadTxns = useCallback((id: string, off: number) => {
    setTxLoading(true);
    getAdminUserTransactions(id, TX_PAGE, off)
      .then((res) => { setTxns(res.transactions); setTxTotal(res.total); })
      .catch(() => setTxns([]))
      .finally(() => setTxLoading(false));
  }, []);

  const openProfile = useCallback((id: string) => {
    setProfileId(id); setProfile(null); setProfileLoading(true);
    setTxns([]); setTxTotal(0); setTxOffset(0);
    getAdminUserProfile(id).then(setProfile).catch(() => setProfile(null)).finally(() => setProfileLoading(false));
    loadTxns(id, 0);
  }, [loadTxns]);

  const closeProfile = useCallback(() => { setProfileId(null); setProfile(null); }, []);

  // ── mutations ──
  const patchUser = useCallback(async (id: string, patch: { is_admin?: boolean; onboarding_completed?: boolean; plan?: string }) => {
    setBusy(true);
    try {
      await updateAdminUser(id, patch);
      setUsers((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      setProfile((p) => (p && p.id === id ? { ...p, ...patch } : p));
      loadOverview();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }, [loadOverview]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleteText !== deleteTarget.email) return;
    setDeleting(true);
    try {
      await deleteAdminUser(deleteTarget.id);
      setUsers((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setUsersTotal((n) => Math.max(0, n - 1));
      if (profileId === deleteTarget.id) closeProfile();
      setDeleteTarget(null); setDeleteText("");
      loadOverview();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setDeleting(false); }
  }, [deleteTarget, deleteText, profileId, closeProfile, loadOverview]);

  const triggerJob = useCallback(async (key: string) => {
    setJobMsg((m) => ({ ...m, [key]: "starting…" }));
    try {
      await runAdminJob(key);
      setJobMsg((m) => ({ ...m, [key]: "started ✓" }));
      setTimeout(() => { loadSystem(); setJobMsg((m) => { const n = { ...m }; delete n[key]; return n; }); }, 4000);
    } catch (e) { setJobMsg((m) => ({ ...m, [key]: e instanceof Error ? e.message : "failed" })); }
  }, [loadSystem]);

  // ── render ──
  if (authorized === null) {
    return (
      <PageLayout maxWidth="xl">
        <div className="h-[40vh] flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-line border-t-brand rounded-full animate-spin" />
        </div>
      </PageLayout>
    );
  }

  const onboardPct = overview && overview.users_total > 0
    ? Math.round((overview.users_onboarded / overview.users_total) * 100) : 0;
  const iAmFounder = Boolean(founderId && meId && founderId === meId);

  const refreshAction = (
    <button onClick={() => { loadOverview(); loadSystem(); loadUsers(search, offset); }}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line hover:border-[#3C3832] hover:bg-surface text-sm text-ink-mute hover:text-ink-soft transition-colors">
      <RefreshCw size={14} /> Refresh
    </button>
  );

  return (
    <PageLayout
      title="Admin"
      titleBadge={
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
          iAmFounder ? "bg-amber-950/40 border-amber-800/50 text-amber-300" : "bg-brand/40 border-brand/50 text-brand"
        }`}>
          <ShieldCheck size={11} /> {iAmFounder ? "founder" : "admin"}
        </span>
      }
      subtitle={overview ? `System snapshot · ${fmtDateTime(overview.generated_at)}` : "System overview & management"}
      action={refreshAction}
      maxWidth="xl"
    >
      {error && <div className="mb-6 bg-red-950/30 border border-red-800/40 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

      {/* GROWTH */}
      {overview && (
        <>
          <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3">Growth</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
            <Metric label="Total users" value={num(overview.users_total)} icon={<TrendingUp size={12} />}
              sub={`${num(overview.users_admins)} admin${overview.users_admins === 1 ? "" : "s"}`} />
            <Metric label="New · 24h" value={num(overview.users_new_24h)} accent="text-emerald-400" />
            <Metric label="New · 7d" value={num(overview.users_new_7d)} accent="text-emerald-400" />
            <Metric label="New · 30d" value={num(overview.users_new_30d)} accent="text-emerald-400" />
            <Metric label="Onboarded" value={`${onboardPct}%`} sub={`${num(overview.users_onboarded)} of ${num(overview.users_total)}`} />
            <Metric label="Weekly email" value={num(overview.users_weekly_email_optin)} sub="opted in" icon={<Bell size={12} />} />
          </div>

          {/* ACTIVITY */}
          <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3">Activity</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
            <Metric label="Transactions" value={num(overview.transactions_total)} icon={<Wallet size={12} />} sub={`+${num(overview.transactions_new_7d)} this week`} />
            <Metric label="Statements" value={num(overview.upload_batches)} sub="upload batches" />
            <Metric label="Assets" value={num(overview.assets_total)} icon={<Scale size={12} />} />
            <Metric label="Liabilities" value={num(overview.liabilities_total)} />
            <Metric label="Open reconciliations" value={num(overview.reconciliation_open)} accent={overview.reconciliation_open > 0 ? "text-amber-400" : "text-ink"} />
            <Metric label="Notifications" value={num(overview.notifications_total)} sub={`${num(overview.notifications_unread)} unread`} />
          </div>
        </>
      )}

      {/* SYSTEM + JOBS */}
      {system && (
        <div className="mb-8 rounded-xl bg-surface border border-line p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase">System</p>
            <span className="text-xs text-ink-mute">
              env: <span className="text-ink-soft font-medium">{system.environment}</span> · scheduler:{" "}
              <span className={system.scheduler.running ? "text-emerald-400" : "text-neg"}>{system.scheduler.running ? "running" : "stopped"}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-5">
            <Chip ok={system.config.llm_configured} label="LLM" />
            <Chip ok={system.config.deepseek_api_key} label="DeepSeek" />
            <Chip ok={system.config.openai_api_key} label="OpenAI" />
            <Chip ok={system.config.resend_api_key} label="Resend email" />
          </div>
          <div className="space-y-2">
            {JOBS.map((j) => {
              const next = system.scheduler.jobs[j.schedJobId]?.next_run ?? null;
              const last = system.scheduler.last_run[j.key] ?? null;
              return (
                <div key={j.key} className="flex items-center gap-3 p-3 rounded-lg bg-canvas border border-line">
                  <Zap size={15} className="text-brand shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-soft">{j.label}</p>
                    <p className="text-xs text-ink-mute">last run: {fmtDateTimeUTC(last)} · next: {fmtDateTimeUTC(next)}</p>
                  </div>
                  {jobMsg[j.key] && <span className="text-xs text-emerald-400 shrink-0">{jobMsg[j.key]}</span>}
                  <button onClick={() => triggerJob(j.key)} disabled={Boolean(jobMsg[j.key])}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-surface-3 text-ink-soft transition-colors disabled:opacity-50">Run now</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* USERS */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase">Users</p>
        <span className="text-xs text-ink-mute">{num(usersTotal)} total</span>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email…"
        className="w-full mb-3 bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-600 focus:outline-none focus:border-brand" />

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-surface text-left text-ink-mute text-xs">
              <th className="px-3 py-2.5 font-medium">User</th>
              <th className="px-3 py-2.5 font-medium">Joined</th>
              <th className="px-3 py-2.5 font-medium text-right">Txns</th>
              <th className="px-3 py-2.5 font-medium text-right">Assets</th>
              <th className="px-3 py-2.5 font-medium">Locale</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {usersLoading && users.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-mute">Loading…</td></tr>}
            {!usersLoading && users.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-mute">No users found.</td></tr>}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-line bg-canvas hover:bg-[#16130F] transition-colors">
                <td className="px-3 py-2.5">
                  <button onClick={() => openProfile(u.id)} className="text-left group inline-flex items-center gap-1.5">
                    <span className="text-ink-soft group-hover:text-brand transition-colors truncate block max-w-[220px]">{u.email}</span>
                    <ArrowRight size={12} className="text-gray-700 group-hover:text-brand transition-colors shrink-0" />
                  </button>
                  {u.id === meId && <span className="block text-[10px] text-ink-mute">you</span>}
                </td>
                <td className="px-3 py-2.5 text-ink-mute text-xs whitespace-nowrap">{fmtDate(u.created_at)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{num(u.transaction_count)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{num(u.asset_count)}</td>
                <td className="px-3 py-2.5 text-ink-mute text-xs whitespace-nowrap">{u.language.toUpperCase()} · {u.display_currency}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {u.id === founderId ? <Badge tone="founder">founder</Badge> : u.is_admin ? <Badge tone="admin">admin</Badge> : null}
                    <Badge tone={u.onboarding_completed ? "ok" : "muted"}>{u.onboarding_completed ? "onboarded" : "new"}</Badge>
                    {u.plan !== "free" && <Badge tone="admin">{u.plan}</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => patchUser(u.id, { is_admin: !u.is_admin })}
                      disabled={busy || (u.id === meId && u.is_admin)} title={u.is_admin ? "Revoke admin" : "Make admin"}
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-line hover:bg-surface-2 text-ink-soft transition-colors disabled:opacity-40 whitespace-nowrap">
                      {u.is_admin ? "Revoke" : "Make admin"}
                    </button>
                    <button onClick={() => setDeleteTarget({ id: u.id, email: u.email })}
                      disabled={u.id === meId} title="Delete user"
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-red-900/50 text-danger hover:bg-red-950/30 transition-colors disabled:opacity-30">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {usersTotal > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <button disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); loadUsers(search, o); }}
            className="px-3 py-1.5 rounded-lg border border-line text-ink-mute hover:bg-surface disabled:opacity-40 transition-colors">Previous</button>
          <span className="text-ink-mute text-xs">{offset + 1}–{Math.min(offset + PAGE_SIZE, usersTotal)} of {num(usersTotal)}</span>
          <button disabled={offset + PAGE_SIZE >= usersTotal} onClick={() => { const o = offset + PAGE_SIZE; setOffset(o); loadUsers(search, o); }}
            className="px-3 py-1.5 rounded-lg border border-line text-ink-mute hover:bg-surface disabled:opacity-40 transition-colors">Next</button>
        </div>
      )}

      {/* ── FULL USER PROFILE OVERLAY ── */}
      {profileId && (
        <div className="fixed inset-0 z-50 overflow-y-auto" onClick={closeProfile}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl mx-auto my-6 bg-canvas border border-line rounded-2xl shadow-2xl shadow-black/60">
            {/* sticky header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-4 bg-canvas/95 backdrop-blur border-b border-line rounded-t-2xl">
              <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase">User profile</p>
              <button onClick={closeProfile} className="text-ink-mute hover:text-ink-soft transition-colors"><XIcon size={18} /></button>
            </div>

            <div className="p-6">
              {profileLoading && <p className="text-ink-mute text-sm py-10 text-center">Loading profile…</p>}
              {!profileLoading && !profile && <p className="text-neg text-sm py-10 text-center">Couldn&apos;t load this user.</p>}

              {profile && (
                <div className="space-y-8">
                  {/* identity header */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-full bg-brand text-white text-lg font-semibold flex items-center justify-center shrink-0">
                        {profile.email[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-ink font-semibold text-lg break-all">{profile.email}</p>
                        <p className="text-ink-mute text-xs mt-0.5 font-mono break-all">{profile.id}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {profile.is_founder ? <Badge tone="founder">founder</Badge> : profile.is_admin ? <Badge tone="admin">admin</Badge> : null}
                          <Badge tone={profile.onboarding_completed ? "ok" : "muted"}>{profile.onboarding_completed ? "onboarded" : "not onboarded"}</Badge>
                          <Badge tone="muted">{profile.language.toUpperCase()} · {profile.display_currency}</Badge>
                          <Badge tone={profile.email_weekly_enabled ? "ok" : "muted"}>weekly email {profile.email_weekly_enabled ? "on" : "off"}</Badge>
                          <Badge tone={profile.plan === "free" ? "muted" : "admin"}>{profile.plan}</Badge>
                          <Badge tone={profile.email_verified ? "ok" : "muted"}>{profile.email_verified ? "verified" : "unverified"}</Badge>
                        </div>
                      </div>
                    </div>
                    {/* actions */}
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button onClick={() => patchUser(profile.id, { is_admin: !profile.is_admin })}
                        disabled={busy || (profile.id === meId && profile.is_admin)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-line hover:bg-surface text-ink-soft transition-colors disabled:opacity-40">
                        {profile.is_admin ? "Revoke admin" : "Make admin"}
                      </button>
                      <button onClick={() => patchUser(profile.id, { onboarding_completed: !profile.onboarding_completed })} disabled={busy}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-line hover:bg-surface text-ink-soft transition-colors disabled:opacity-40">
                        {profile.onboarding_completed ? "Reset onboarding" : "Mark onboarded"}
                      </button>
                      {/* Plan: free / plus / pro — active tier highlighted */}
                      <div className="flex items-center rounded-lg border border-line overflow-hidden text-xs font-medium">
                        <span className="px-2 py-1.5 text-ink-mute border-r border-line">plan</span>
                        {(["free", "plus", "pro"] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => patchUser(profile.id, { plan: p })}
                            disabled={busy || profile.plan === p}
                            className={`px-2.5 py-1.5 transition-colors ${
                              profile.plan === p ? "bg-brand text-white" : "text-ink-soft hover:bg-surface"
                            } disabled:opacity-60`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => setDeleteTarget({ id: profile.id, email: profile.email })} disabled={profile.id === meId}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-900/50 text-danger hover:bg-red-950/30 transition-colors disabled:opacity-30">Delete</button>
                    </div>
                  </div>

                  {/* health + timeline strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl bg-surface border border-line p-4 col-span-2 sm:col-span-1">
                      <div className="flex items-center gap-1.5 text-ink-mute text-[11px] uppercase tracking-wide mb-2"><Target size={12} /> Health</div>
                      {profile.health && profile.health.has_data && profile.health.score != null ? (
                        <>
                          <p className={`text-2xl font-bold tabular-nums ${BAND_COLOR[profile.health.band ?? ""] ?? "text-ink"}`}>
                            {profile.health.score}<span className="text-ink-mute text-sm font-normal"> / 100</span>
                          </p>
                          <p className="text-ink-mute text-xs mt-1 capitalize">{slug(profile.health.band ?? "")}</p>
                        </>
                      ) : <p className="text-ink-mute text-sm mt-1">Not enough data</p>}
                    </div>
                    <Metric label="Last activity" value={relativeTime(profile.last_activity)} sub={fmtDateTime(profile.last_activity)} icon={<Calendar size={12} />} />
                    <Metric label="Joined" value={fmtDate(profile.created_at)} sub={relativeTime(profile.created_at)} />
                    <Metric label="Last brief" value={profile.last_email_brief_sent ? fmtDate(profile.last_email_brief_sent) : "never"} icon={<Bell size={12} />} />
                  </div>

                  {/* count strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <Metric label="Transactions" value={num(profile.transaction_count)} />
                    <Metric label="Statements" value={num(profile.upload_batches)} />
                    <Metric label="Assets" value={num(profile.asset_count)} />
                    <Metric label="Liabilities" value={num(profile.liability_count)} />
                    <Metric label="Open recon." value={num(profile.reconciliation_open)} accent={profile.reconciliation_open > 0 ? "text-amber-400" : "text-ink"} />
                  </div>

                  {/* statements */}
                  <section>
                    <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3"><FileText size={12} /> Statements ({profile.statements.length})</p>
                    {profile.statements.length === 0 ? <p className="text-ink-mute text-sm">No statements uploaded.</p> : (
                      <div className="space-y-1.5">
                        {profile.statements.map((s) => (
                          <div key={s.batch_id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-line text-sm">
                            <div className="min-w-0">
                              <p className="text-ink-soft">{fmtDate(s.min_date)} – {fmtDate(s.max_date)}</p>
                              <p className="text-ink-mute text-xs">uploaded {fmtDateTime(s.uploaded_at)}</p>
                            </div>
                            <span className="text-ink-mute tabular-nums shrink-0">{num(s.transaction_count)} txns</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* assets + liabilities side by side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <section>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3"><Scale size={12} /> Assets ({profile.assets.length})</p>
                      {profile.assets.length === 0 ? <p className="text-ink-mute text-sm">No assets.</p> : (
                        <div className="space-y-1.5">
                          {profile.assets.map((a) => (
                            <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-line text-sm">
                              <div className="min-w-0">
                                <p className="text-ink-soft truncate">{a.name}</p>
                                <p className="text-ink-mute text-xs capitalize">{slug(a.asset_type)}</p>
                              </div>
                              <span className="text-emerald-300 tabular-nums shrink-0">{money(a.current_value, a.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                    <section>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3"><TrendingDown size={12} /> Liabilities ({profile.liabilities.length})</p>
                      {profile.liabilities.length === 0 ? <p className="text-ink-mute text-sm">No liabilities.</p> : (
                        <div className="space-y-1.5">
                          {profile.liabilities.map((li) => (
                            <div key={li.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-line text-sm">
                              <div className="min-w-0">
                                <p className="text-ink-soft truncate">{li.name}</p>
                                <p className="text-ink-mute text-xs capitalize">{slug(li.liability_type)}{li.interest_rate ? ` · ${li.interest_rate}%` : ""}</p>
                              </div>
                              <span className="text-red-300 tabular-nums shrink-0">{money(li.remaining_amount, li.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* receivables (only if any) */}
                  {profile.receivables.length > 0 && (
                    <section>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3"><Wallet size={12} /> Receivables ({profile.receivables.length})</p>
                      <div className="space-y-1.5">
                        {profile.receivables.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-line text-sm">
                            <div className="min-w-0">
                              <p className="text-ink-soft truncate">{r.from_person}</p>
                              <p className="text-ink-mute text-xs">{r.status}{r.expected_date ? ` · due ${fmtDate(r.expected_date)}` : ""}</p>
                            </div>
                            <span className="text-ink-soft tabular-nums shrink-0">{money(r.amount, r.currency)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* transactions (paginated) */}
                  <section>
                    <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3"><Wallet size={12} /> Transactions ({num(txTotal)})</p>
                    {txTotal === 0 && !txLoading ? <p className="text-ink-mute text-sm">No transactions.</p> : (
                      <>
                        <div className="overflow-x-auto rounded-xl border border-line">
                          <table className="w-full text-sm min-w-[560px]">
                            <thead>
                              <tr className="bg-surface text-left text-ink-mute text-xs">
                                <th className="px-3 py-2 font-medium">Date</th>
                                <th className="px-3 py-2 font-medium">Description</th>
                                <th className="px-3 py-2 font-medium">Category</th>
                                <th className="px-3 py-2 font-medium text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {txLoading && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-mute">Loading…</td></tr>}
                              {!txLoading && txns.map((t) => (
                                <tr key={t.id} className="border-t border-line bg-canvas">
                                  <td className="px-3 py-2 text-ink-mute text-xs whitespace-nowrap">{fmtDate(t.transaction_date)}</td>
                                  <td className="px-3 py-2 text-ink-soft truncate max-w-[260px]" title={t.description}>{t.description}</td>
                                  <td className="px-3 py-2 text-ink-mute text-xs">{t.category ? (CATEGORY_LABELS[t.category] || t.category) : "—"}</td>
                                  <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${t.transaction_type === "credit" ? "text-emerald-300" : "text-ink-soft"}`}>
                                    {t.transaction_type === "credit" ? "+" : "−"}{money(t.amount, t.currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {txTotal > TX_PAGE && (
                          <div className="flex items-center justify-between mt-3 text-sm">
                            <button disabled={txOffset === 0 || txLoading}
                              onClick={() => { const o = Math.max(0, txOffset - TX_PAGE); setTxOffset(o); loadTxns(profile.id, o); }}
                              className="px-3 py-1.5 rounded-lg border border-line text-ink-mute hover:bg-surface disabled:opacity-40 transition-colors">Previous</button>
                            <span className="text-ink-mute text-xs">{txOffset + 1}–{Math.min(txOffset + TX_PAGE, txTotal)} of {num(txTotal)}</span>
                            <button disabled={txOffset + TX_PAGE >= txTotal || txLoading}
                              onClick={() => { const o = txOffset + TX_PAGE; setTxOffset(o); loadTxns(profile.id, o); }}
                              className="px-3 py-1.5 rounded-lg border border-line text-ink-mute hover:bg-surface disabled:opacity-40 transition-colors">Next</button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION (typed email) ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => { if (!deleting) { setDeleteTarget(null); setDeleteText(""); } }}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md bg-surface border border-red-900/50 rounded-2xl shadow-2xl shadow-black/60 p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full bg-red-950/50 border border-red-800/50 flex items-center justify-center text-neg text-lg font-bold">!</span>
              <h2 className="text-ink font-semibold">Delete this user?</h2>
            </div>
            <p className="text-ink-mute text-sm leading-relaxed mb-4">
              This permanently deletes <span className="text-ink-soft font-medium break-all">{deleteTarget.email}</span> and{" "}
              <span className="text-red-300">all of their data</span> — transactions, statements, assets, liabilities. This cannot be undone.
            </p>
            <label className="block text-xs text-ink-mute mb-1.5">Type the email to confirm</label>
            <input autoFocus value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
              placeholder={deleteTarget.email}
              className="w-full mb-4 bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-700 focus:outline-none focus:border-red-600" />
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setDeleteText(""); }} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-ink-soft text-sm font-medium transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting || deleteText !== deleteTarget.email}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-ink text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {deleting ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting…</> : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

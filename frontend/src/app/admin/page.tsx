"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import {
  ShieldCheck, RefreshCw, TrendingUp, Wallet, Scale, Bell, Zap, CheckCircle, X as XIcon,
} from "@/components/ui/Icons";
import {
  getToken, getStoredUser,
  getAdminOverview, getAdminSystem, getAdminUsers, getAdminUser,
  updateAdminUser, deleteAdminUser, runAdminJob,
  type AdminOverview, type AdminSystem, type AdminUserRow, type AdminUserDetail,
} from "@/lib/api";

// ── small format helpers ───────────────────────────────────────────────────────
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
function num(n: number): string {
  return new Intl.NumberFormat(undefined).format(n);
}

const PAGE_SIZE = 25;

// key       → POST /admin/jobs/{key}   (and last_run lookup key)
// schedJobId → scheduler.jobs[…] lookup for next_run
const JOBS: { key: string; label: string; schedJobId: string }[] = [
  { key: "reconciliation", label: "Reconciliation scan", schedJobId: "reconciliation_all_users" },
  { key: "daily_notifications", label: "Daily notifications", schedJobId: "daily_notifications_all_users" },
  { key: "price_refresh", label: "Price refresh + snapshot", schedJobId: "price_refresh_all_users" },
  { key: "email_briefs", label: "Weekly email briefs", schedJobId: "email_briefs_all_users" },
];

// ── metric card ─────────────────────────────────────────────────────────────────
function Metric({ label, value, sub, icon, accent = "text-white" }: {
  label: string; value: string; sub?: string; icon?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] p-4">
      <div className="flex items-center gap-1.5 text-gray-500 text-[11px] uppercase tracking-wide mb-2">
        {icon}{label}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="text-gray-600 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
      ok ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300" : "bg-red-950/30 border-red-800/40 text-red-300"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
      {label}
    </span>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // users
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);

  // detail drawer + per-row busy state + job feedback
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [jobMsg, setJobMsg] = useState<Record<string, string>>({});

  const meId = getStoredUser()?.id ?? "";

  const loadSystem = useCallback(() => {
    getAdminSystem().then(setSystem).catch(() => { /* non-blocking */ });
  }, []);

  const loadOverview = useCallback(() => {
    getAdminOverview().then(setOverview).catch((e) => {
      if (e instanceof Error && e.message === "forbidden") router.replace("/home");
    });
  }, [router]);

  const loadUsers = useCallback((searchTerm: string, off: number) => {
    setUsersLoading(true);
    getAdminUsers(searchTerm, PAGE_SIZE, off)
      .then((res) => { setUsers(res.users); setUsersTotal(res.total); })
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, []);

  // Auth gate: the server is the source of truth. Try the overview; a 403 → home.
  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    Promise.all([getAdminOverview(), getAdminSystem()])
      .then(([o, s]) => { setOverview(o); setSystem(s); setAuthorized(true); loadUsers("", 0); })
      .catch((e) => {
        if (e instanceof Error && e.message === "forbidden") { router.replace("/home"); return; }
        setAuthorized(true);
        setError("Couldn't load admin data.");
      });
  }, [router, loadUsers]);

  // Debounced search.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (authorized !== true) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setOffset(0); loadUsers(search, 0); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, authorized, loadUsers]);

  const refreshAll = useCallback(() => {
    loadOverview(); loadSystem(); loadUsers(search, offset);
  }, [loadOverview, loadSystem, loadUsers, search, offset]);

  // ── user actions ──
  const toggleAdmin = useCallback(async (u: AdminUserRow) => {
    if (u.id === meId && u.is_admin) { alert("You can't revoke your own admin access."); return; }
    setBusyId(u.id);
    try {
      await updateAdminUser(u.id, { is_admin: !u.is_admin });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_admin: !u.is_admin } : x)));
      loadOverview();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusyId(null); }
  }, [meId, loadOverview]);

  const resetOnboarding = useCallback(async (u: AdminUserRow) => {
    setBusyId(u.id);
    try {
      await updateAdminUser(u.id, { onboarding_completed: !u.onboarding_completed });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, onboarding_completed: !u.onboarding_completed } : x)));
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusyId(null); }
  }, []);

  const removeUser = useCallback(async (u: AdminUserRow) => {
    if (u.id === meId) { alert("You can't delete your own account here."); return; }
    if (!window.confirm(`Delete ${u.email}? This permanently removes the account and all its data.`)) return;
    setBusyId(u.id);
    try {
      await deleteAdminUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      setUsersTotal((n) => Math.max(0, n - 1));
      loadOverview();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusyId(null); }
  }, [meId, loadOverview]);

  const openDetail = useCallback((id: string) => {
    setDetailLoading(true); setDetail(null);
    getAdminUser(id).then(setDetail).catch(() => setDetail(null)).finally(() => setDetailLoading(false));
  }, []);

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
          <span className="w-6 h-6 border-2 border-[#2A2A2A] border-t-indigo-400 rounded-full animate-spin" />
        </div>
      </PageLayout>
    );
  }

  const onboardPct = overview && overview.users_total > 0
    ? Math.round((overview.users_onboarded / overview.users_total) * 100) : 0;

  const refreshAction = (
    <button onClick={refreshAll}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#2A2A2A] hover:border-[#3A3A3A] hover:bg-[#1A1A1A] text-sm text-gray-400 hover:text-gray-200 transition-colors">
      <RefreshCw size={14} /> Refresh
    </button>
  );

  return (
    <PageLayout
      title="Admin"
      titleBadge={<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/40 border border-amber-800/50 text-amber-300"><ShieldCheck size={11} /> founder</span>}
      subtitle={overview ? `System snapshot · ${fmtDateTime(overview.generated_at)}` : "System overview & management"}
      action={refreshAction}
      maxWidth="xl"
    >
      {error && (
        <div className="mb-6 bg-red-950/30 border border-red-800/40 rounded-xl p-4 text-red-300 text-sm">{error}</div>
      )}

      {/* ── GROWTH ── */}
      {overview && (
        <>
          <p className="text-[11px] font-bold tracking-widest text-gray-600 uppercase mb-3">Growth</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
            <Metric label="Total users" value={num(overview.users_total)} icon={<TrendingUp size={12} />}
              sub={`${num(overview.users_admins)} admin${overview.users_admins === 1 ? "" : "s"}`} />
            <Metric label="New · 24h" value={num(overview.users_new_24h)} accent="text-emerald-400" />
            <Metric label="New · 7d" value={num(overview.users_new_7d)} accent="text-emerald-400" />
            <Metric label="New · 30d" value={num(overview.users_new_30d)} accent="text-emerald-400" />
            <Metric label="Onboarded" value={`${onboardPct}%`}
              sub={`${num(overview.users_onboarded)} of ${num(overview.users_total)}`} />
            <Metric label="Weekly email" value={num(overview.users_weekly_email_optin)} sub="opted in" icon={<Bell size={12} />} />
          </div>

          {/* ── ACTIVITY ── */}
          <p className="text-[11px] font-bold tracking-widest text-gray-600 uppercase mb-3">Activity</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
            <Metric label="Transactions" value={num(overview.transactions_total)} icon={<Wallet size={12} />}
              sub={`+${num(overview.transactions_new_7d)} this week`} />
            <Metric label="Statements" value={num(overview.upload_batches)} sub="upload batches" />
            <Metric label="Assets" value={num(overview.assets_total)} icon={<Scale size={12} />} />
            <Metric label="Liabilities" value={num(overview.liabilities_total)} />
            <Metric label="Open reconciliations" value={num(overview.reconciliation_open)}
              accent={overview.reconciliation_open > 0 ? "text-amber-400" : "text-white"} />
            <Metric label="Notifications" value={num(overview.notifications_total)}
              sub={`${num(overview.notifications_unread)} unread`} />
          </div>
        </>
      )}

      {/* ── SYSTEM HEALTH + JOBS ── */}
      {system && (
        <div className="mb-8 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold tracking-widest text-gray-600 uppercase">System</p>
            <span className="text-xs text-gray-500">
              env: <span className="text-gray-300 font-medium">{system.environment}</span> ·
              scheduler: <span className={system.scheduler.running ? "text-emerald-400" : "text-red-400"}>
                {system.scheduler.running ? "running" : "stopped"}</span>
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
                <div key={j.key} className="flex items-center gap-3 p-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A]">
                  <Zap size={15} className="text-indigo-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200">{j.label}</p>
                    <p className="text-xs text-gray-600">
                      last run: {fmtDateTime(last)} · next: {fmtDateTime(next)}
                    </p>
                  </div>
                  {jobMsg[j.key] && <span className="text-xs text-emerald-400 shrink-0">{jobMsg[j.key]}</span>}
                  <button onClick={() => triggerJob(j.key)} disabled={Boolean(jobMsg[j.key])}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2A2A2A] hover:bg-[#333] text-gray-200 transition-colors disabled:opacity-50">
                    Run now
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── USERS ── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold tracking-widest text-gray-600 uppercase">Users</p>
        <span className="text-xs text-gray-600">{num(usersTotal)} total</span>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email…"
        className="w-full mb-3 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
      />

      <div className="overflow-x-auto rounded-xl border border-[#2A2A2A]">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-[#1A1A1A] text-left text-gray-500 text-xs">
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
            {usersLoading && users.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600">Loading…</td></tr>
            )}
            {!usersLoading && users.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600">No users found.</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[#2A2A2A] bg-[#0F0F0F] hover:bg-[#141414] transition-colors">
                <td className="px-3 py-2.5">
                  <button onClick={() => openDetail(u.id)} className="text-left group">
                    <span className="text-gray-200 group-hover:text-indigo-300 transition-colors truncate block max-w-[220px]">{u.email}</span>
                    {u.id === meId && <span className="text-[10px] text-gray-600">you</span>}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{fmtDate(u.created_at)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">{num(u.transaction_count)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">{num(u.asset_count)}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{u.language.toUpperCase()} · {u.display_currency}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {u.is_admin && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-950/40 text-amber-300 border border-amber-800/40">admin</span>}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                      u.onboarding_completed ? "bg-emerald-950/30 text-emerald-300 border-emerald-800/40" : "bg-[#2A2A2A] text-gray-500 border-[#2A2A2A]"
                    }`}>{u.onboarding_completed ? "onboarded" : "new"}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => toggleAdmin(u)} disabled={busyId === u.id}
                      title={u.is_admin ? "Revoke admin" : "Make admin"}
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-[#2A2A2A] hover:bg-[#2A2A2A] text-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap">
                      {u.is_admin ? "Revoke" : "Make admin"}
                    </button>
                    <button onClick={() => resetOnboarding(u)} disabled={busyId === u.id}
                      title="Toggle onboarding flag"
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-[#2A2A2A] hover:bg-[#2A2A2A] text-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap">
                      {u.onboarding_completed ? "Reset onb." : "Mark onb."}
                    </button>
                    <button onClick={() => removeUser(u)} disabled={busyId === u.id || u.id === meId}
                      title="Delete user"
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-red-900/50 text-red-400 hover:bg-red-950/30 transition-colors disabled:opacity-30">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {usersTotal > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <button
            disabled={offset === 0}
            onClick={() => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); loadUsers(search, o); }}
            className="px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-gray-400 hover:bg-[#1A1A1A] disabled:opacity-40 transition-colors"
          >Previous</button>
          <span className="text-gray-600 text-xs">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, usersTotal)} of {num(usersTotal)}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= usersTotal}
            onClick={() => { const o = offset + PAGE_SIZE; setOffset(o); loadUsers(search, o); }}
            className="px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-gray-400 hover:bg-[#1A1A1A] disabled:opacity-40 transition-colors"
          >Next</button>
        </div>
      )}

      {/* ── USER DETAIL DRAWER ── */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => { setDetail(null); }}>
          <div className="absolute inset-0 bg-black/60" />
          <div onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md h-full bg-[#0F0F0F] border-l border-[#2A2A2A] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <p className="text-[11px] font-bold tracking-widest text-gray-600 uppercase">User detail</p>
              <button onClick={() => setDetail(null)} className="text-gray-500 hover:text-gray-200 transition-colors"><XIcon size={18} /></button>
            </div>
            {detailLoading && <p className="text-gray-500 text-sm">Loading…</p>}
            {detail && (
              <div className="space-y-5">
                <div>
                  <p className="text-white font-semibold break-all">{detail.email}</p>
                  <p className="text-gray-600 text-xs mt-1">id: {detail.id}</p>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {detail.is_admin && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/40 text-amber-300 border border-amber-800/40">admin</span>}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${detail.onboarding_completed ? "bg-emerald-950/30 text-emerald-300 border-emerald-800/40" : "bg-[#2A2A2A] text-gray-500 border-[#2A2A2A]"}`}>{detail.onboarding_completed ? "onboarded" : "not onboarded"}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1A1A1A] text-gray-400 border border-[#2A2A2A]">{detail.language.toUpperCase()} · {detail.display_currency}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Transactions" value={num(detail.transaction_count)} />
                  <Metric label="Statements" value={num(detail.upload_batches)} />
                  <Metric label="Assets" value={num(detail.asset_count)} />
                  <Metric label="Liabilities" value={num(detail.liability_count)} />
                  <Metric label="Open recon." value={num(detail.reconciliation_open)} accent={detail.reconciliation_open > 0 ? "text-amber-400" : "text-white"} />
                </div>

                <div className="space-y-2 text-sm text-gray-400 border-t border-[#2A2A2A] pt-4">
                  <div className="flex items-center justify-between"><span className="text-gray-600">Joined</span><span>{fmtDate(detail.created_at)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-gray-600">Weekly email</span>
                    <span className="flex items-center gap-1.5">{detail.email_weekly_enabled ? <><CheckCircle size={13} className="text-emerald-400" /> on</> : "off"}</span></div>
                  <div className="flex items-center justify-between"><span className="text-gray-600">Last brief sent</span><span>{fmtDateTime(detail.last_email_brief_sent)}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

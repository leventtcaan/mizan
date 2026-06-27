"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Mim from "@/components/companion/Mim";
import { Home, BarChart2, Scale, FileText, Sparkles, ArrowRight, X as XIcon, CheckCircle } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { getStoredUser } from "@/lib/api";

/**
 * Clar's guided product tour. Two moments:
 *  1) OFFER + TOUR — after onboarding, when the user first reaches Home, Clar offers a
 *     30-second walkthrough of the main sections (Home, Money Flow, Net Worth, Reports,
 *     Simulator). Pro-only sections show what free/Plus users are missing + an upgrade nudge.
 *  2) UNLOCK — when the user upgrades, Clar reappears anywhere with a welcome celebrating
 *     the features they just unlocked.
 *
 * Component/var/file names are unchanged elsewhere; the displayed companion name is "Clar".
 */

const TOUR_DONE = "clar_tour_done";
const SEEN_PLAN = "clar_seen_plan";
// Don't intrude on auth / full-screen flow pages.
const HIDDEN = new Set(["/", "/login", "/onboarding", "/verify", "/brief", "/review"]);

type Plan = "free" | "plus" | "pro";
const rank = (p: string): number => ({ free: 0, plus: 1, pro: 2 }[p as Plan] ?? 0);

type Mode = null | "offer" | "tour" | "unlock";

interface Section {
  key: string; route: string; icon: React.ReactNode; title: string; body: string; pro: boolean;
}

export default function ClarTour() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const tr = lang === "tr";

  const [mode, setMode] = useState<Mode>(null);
  const [plan, setPlan] = useState<Plan>("free");
  const [step, setStep] = useState(0);
  // Mirror of `mode` so re-evaluations (on focus / route change) don't disturb an
  // in-progress tour or an open unlock card.
  const modeRef = useRef<Mode>(null);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const evaluate = useCallback(() => {
    if (typeof window === "undefined") return;
    const user = getStoredUser();
    if (!user || HIDDEN.has(pathname)) {
      if (modeRef.current !== "tour" && modeRef.current !== "unlock") setMode(null);
      return;
    }
    const p = (user.plan as Plan) || "free";
    setPlan(p);

    // Baseline the "seen" plan on first ever run so we never fire a false unlock.
    let seen = localStorage.getItem(SEEN_PLAN);
    if (seen === null) { localStorage.setItem(SEEN_PLAN, p); seen = p; }

    let desired: Mode = null;
    if (rank(p) > rank(seen)) desired = "unlock";
    else if (!localStorage.getItem(TOUR_DONE) && pathname === "/home") desired = "offer";

    const cur = modeRef.current;
    if (cur === "tour" && desired !== "unlock") return;     // don't interrupt an active tour
    if (cur === "unlock" && desired !== "unlock") return;   // keep the unlock card open
    setMode(desired);
  }, [pathname]);

  useEffect(() => {
    evaluate();
    const onPlan = () => evaluate();
    window.addEventListener("clar-plan-changed", onPlan);
    window.addEventListener("focus", onPlan);
    return () => {
      window.removeEventListener("clar-plan-changed", onPlan);
      window.removeEventListener("focus", onPlan);
    };
  }, [evaluate]);

  const finishTour = () => { try { localStorage.setItem(TOUR_DONE, "1"); } catch { /* */ } setMode(null); };
  const dismissUnlock = () => {
    try { localStorage.setItem(SEEN_PLAN, plan); localStorage.setItem(TOUR_DONE, "1"); } catch { /* */ }
    setMode(null);
  };

  if (mode === null) return null;

  const isPro = plan === "pro";

  const sections: Section[] = tr
    ? [
        { key: "home", route: "/home", icon: <Home size={20} />, title: "Ana Sayfa", body: "Günlük durağın. Clar seni karşılar, dikkat etmen gereken tek şeyi ve paranın özetini gösterir.", pro: false },
        { key: "money", route: "/transactions", icon: <BarChart2 size={20} />, title: "Para Akışı", body: "Hareket eden her şey: işlemlerin, yaklaşan ödemelerin ve tekrarlayan abonelikler tek yerde.", pro: false },
        { key: "networth", route: "/networth", icon: <Scale size={20} />, title: "Net Değer", body: "Sahip olduğun ve borçlu olduğun her şeyi takip et — varlıklar, borçlar, alacaklar — ve gerçek net değerini gör.", pro: false },
        { key: "reports", route: "/reports", icon: <FileText size={20} />, title: "Raporlar", body: "Finansını yazdırabileceğin ya da PDF, CSV ve Excel'e aktarabileceğin temiz bir rapora dönüştür.", pro: true },
        { key: "sim", route: "/simulator", icon: <Sparkles size={20} />, title: "Simülatör", body: "\"Ya şöyle olsaydı?\" diye sor — daha çok biriktirmek ya da borç kapatmak gibi kararları modelle, geleceğine etkisini gör.", pro: true },
      ]
    : [
        { key: "home", route: "/home", icon: <Home size={20} />, title: "Home", body: "Your daily check-in. Clar greets you with the one thing that needs your attention and a snapshot of your money.", pro: false },
        { key: "money", route: "/transactions", icon: <BarChart2 size={20} />, title: "Money Flow", body: "Everything that moves: your transactions, upcoming payments, and recurring subscriptions in one place.", pro: false },
        { key: "networth", route: "/networth", icon: <Scale size={20} />, title: "Net Worth", body: "Track everything you own and owe — assets, debts, receivables — and watch your true net worth.", pro: false },
        { key: "reports", route: "/reports", icon: <FileText size={20} />, title: "Reports", body: "Turn your finances into a clean report you can print or export to PDF, CSV and Excel.", pro: true },
        { key: "sim", route: "/simulator", icon: <Sparkles size={20} />, title: "Simulator", body: "Ask \"what if?\" — model decisions like saving more or paying off debt and see the impact on your future.", pro: true },
      ];

  // ── OFFER — a gentle corner nudge, not a modal ──
  if (mode === "offer") {
    return (
      <div className="fixed z-[70] bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm" style={{ animation: "clarIn .35s ease both" }}>
        <Style />
        <div className="rounded-2xl border border-line bg-surface shadow-2xl shadow-black/20 p-4">
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <span className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(23,107,91,0.25), transparent 70%)", transform: "scale(1.5)" }} />
              <Mim size={44} mood="happy" speaking />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-ink text-sm font-semibold">{tr ? "Ben Clar 👋" : "I'm Clar 👋"}</p>
              <p className="text-ink-soft text-sm mt-0.5 leading-relaxed">
                {tr ? "Burada neler var, 30 saniyede gezdireyim mi?" : "Want a quick 30-second tour of what's here?"}
              </p>
            </div>
            <button onClick={finishTour} aria-label="Close" className="shrink-0 text-ink-mute hover:text-ink-soft transition-colors"><XIcon size={16} /></button>
          </div>
          <div className="flex items-center gap-2 mt-3.5">
            <button
              onClick={() => { setStep(0); setMode("tour"); }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors"
            >
              {tr ? "Turu başlat" : "Start tour"} <ArrowRight size={15} />
            </button>
            <button onClick={finishTour} className="px-3 py-2 rounded-lg text-ink-mute hover:text-ink-soft text-sm font-medium transition-colors">
              {tr ? "Sonra" : "Maybe later"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── UNLOCK — celebrate newly available features ──
  if (mode === "unlock") {
    const feats = plan === "pro"
      ? (tr
          ? ["Finansal raporlar — PDF, CSV ve Excel", "Simülatör — her para kararını modelle", "Net değer rehberi", "Sınırsız AI asistan"]
          : ["Financial reports — PDF, CSV & Excel", "The Simulator — model any money decision", "Net Worth guidance", "Unlimited AI assistant"])
      : (tr
          ? ["Sınırsız ekstre yükleme", "Her ekstre için brifing", "Tekrarlayan ödeme takibi", "Haftalık para brifingi"]
          : ["Unlimited statement uploads", "A brief for every statement", "Recurring payment tracking", "Weekly money brief"]);
    const exploreRoute = plan === "pro" ? "/reports" : "/upload";
    const planName = plan.charAt(0).toUpperCase() + plan.slice(1);

    return (
      <Backdrop onClose={dismissUnlock}>
        <div className="text-center">
          <ClarHead mood="happy" />
          <h2 className="text-xl font-bold text-ink mt-4">
            {tr ? `${planName} aktif! 🎉` : `You're on ${planName} now! 🎉`}
          </h2>
          <p className="text-ink-soft text-sm mt-1.5 leading-relaxed">
            {tr ? "Yeni açtığın özellikler:" : "Here's what you just unlocked:"}
          </p>
        </div>
        <ul className="mt-5 space-y-2.5 text-left">
          {feats.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-ink-soft">
              <CheckCircle size={17} className="text-[#176B5B] shrink-0 mt-0.5" /><span>{f}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 mt-6">
          <Link
            href={exploreRoute}
            onClick={dismissUnlock}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors"
          >
            {tr ? "Keşfet" : "Explore"} <ArrowRight size={15} />
          </Link>
          <button onClick={dismissUnlock} className="px-4 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors">
            {tr ? "Tamam" : "Done"}
          </button>
        </div>
      </Backdrop>
    );
  }

  // ── TOUR — the guided walkthrough ──
  const s = sections[step];
  const locked = s.pro && !isPro;
  const last = step === sections.length - 1;

  return (
    <Backdrop onClose={finishTour}>
      <button onClick={finishTour} aria-label="Skip" className="absolute top-3.5 right-3.5 text-ink-mute hover:text-ink-soft transition-colors">
        <XIcon size={18} />
      </button>

      <div className="text-center">
        <ClarHead mood="calm" />
      </div>

      {/* Section card */}
      <div className="mt-5 rounded-2xl border border-line bg-surface-2/40 p-5">
        <div className="flex items-center gap-3 mb-2.5">
          <span className="w-10 h-10 rounded-xl bg-[#176B5B]/10 text-[#176B5B] flex items-center justify-center shrink-0">{s.icon}</span>
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base font-bold text-ink truncate">{s.title}</h3>
            {s.pro && (
              <span className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 shrink-0">Pro</span>
            )}
          </div>
        </div>
        <p className="text-ink-soft text-sm leading-relaxed">{s.body}</p>

        {locked && (
          <div className="mt-3.5 rounded-xl border border-[#176B5B]/30 bg-[#176B5B]/[0.06] p-3">
            <p className="text-ink-soft text-xs leading-relaxed mb-2">
              {tr ? "Bu bir Pro özelliği — Pro'ya geçince açılır." : "This is a Pro feature — unlock it by upgrading to Pro."}
            </p>
            <Link
              href="/upgrade"
              onClick={finishTour}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#176B5B] hover:text-[#125848] transition-colors"
            >
              <Sparkles size={14} /> {tr ? "Pro'ya geç" : "Upgrade to Pro"} <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </div>

      {/* Footer: progress + nav */}
      <div className="flex items-center justify-between mt-6">
        <div className="flex items-center gap-1.5">
          {sections.map((_, i) => (
            <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === step ? 18 : 6, backgroundColor: i === step ? "#176B5B" : "rgb(var(--c-line))" }} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button onClick={() => setStep((i) => Math.max(0, i - 1))} className="px-3 py-2 rounded-lg border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors">
              {tr ? "Geri" : "Back"}
            </button>
          )}
          {last ? (
            <Link href="/home" onClick={finishTour} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
              {tr ? "Hadi başlayalım" : "Let's go"} <ArrowRight size={15} />
            </Link>
          ) : (
            <button onClick={() => setStep((i) => Math.min(sections.length - 1, i + 1))} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
              {tr ? "İleri" : "Next"} <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </Backdrop>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 bg-black/40 backdrop-blur-[2px]" style={{ animation: "clarFade .25s ease both" }} onClick={onClose}>
      <Style />
      <div
        className="relative w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl shadow-black/30 p-6"
        style={{ animation: "clarPop .3s ease both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ClarHead({ mood }: { mood: "calm" | "happy" }) {
  return (
    <div className="relative inline-flex items-center justify-center mx-auto" style={{ width: 84, height: 84 }}>
      <span className="absolute rounded-full" style={{ width: 84, height: 84, background: "radial-gradient(circle, rgba(23,107,91,0.22), transparent 70%)" }} />
      <Mim size={68} mood={mood} speaking />
    </div>
  );
}

function Style() {
  return (
    <style>{`
      @keyframes clarIn { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }
      @keyframes clarFade { from { opacity:0 } to { opacity:1 } }
      @keyframes clarPop { from { opacity:0; transform: translateY(8px) scale(.98) } to { opacity:1; transform:none } }
    `}</style>
  );
}

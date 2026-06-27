"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Mim from "@/components/companion/Mim";
import { Home, BarChart2, Scale, FileText, Sparkles, ArrowRight, X as XIcon, CheckCircle, Upload } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { getStoredUser } from "@/lib/api";

/**
 * Clar's guided product tour — an Intercom/Appcues-style walkthrough.
 *  • OFFER: after onboarding, a gentle corner nudge on Home.
 *  • TOUR: navigates through the real pages (Home → Money Flow → Upload → Net Worth →
 *    Reports → Simulator → Progress → Assistant), spotlighting the relevant element on
 *    each with a tooltip that explains what it does + how to use it. Pro-only steps show
 *    an upgrade nudge for non-Pro users. Ends with a summary + CTA.
 *  • UNLOCK: when the user upgrades, Clar reappears celebrating what they unlocked.
 *
 * Lives in the root layout so it persists across the navigations it drives.
 */

const TOUR_DONE = "clar_tour_done";
const SEEN_PLAN = "clar_seen_plan";
const HIDDEN = new Set(["/", "/login", "/onboarding", "/verify", "/brief", "/review"]);

type Plan = "free" | "plus" | "pro";
const rank = (p: string): number => ({ free: 0, plus: 1, pro: 2 }[p as Plan] ?? 0);

type Mode = null | "offer" | "tour" | "unlock";
type Rect = { top: number; left: number; width: number; height: number };

interface Step {
  id: string;
  route: string;
  target: string | null;          // CSS selector to spotlight; null = centered card
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: string;                // an actionable "do this" line
  pro?: boolean;
}

const PAD = 8;

// Pick the first VISIBLE match (handles desktop/mobile duplicate nav links).
function findVisible(sel: string): Element | null {
  const els = Array.from(document.querySelectorAll(sel));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return els[0] ?? null;
}

function buildSteps(tr: boolean): Step[] {
  if (tr) {
    return [
      { id: "welcome", route: "/home", target: null, title: "Clarifin'e hoş geldin 👋", body: "Ben Clar. Her şeyin nerede olduğunu bilmen için sana 60 saniyelik hızlı bir tur vereyim." },
      { id: "home", route: "/home", target: '[data-tour="home"]', icon: <Home size={18} />, title: "Burası Ana Sayfa", body: "Günlük durağın. Seni karşılar, dikkat etmen gereken tek şeyi ve paranın özetini gösteririm." },
      { id: "money", route: "/transactions", target: 'a[href="/transactions"]', icon: <BarChart2 size={18} />, title: "Para Akışı", body: "Her işlem, yaklaşan ödeme ve abonelik tek yerde. Sekmeler Hareketler, Yaklaşan ve Tekrarlayan arasında geçiş yapar.", action: "Açmak için buraya dokun" },
      { id: "upload", route: "/transactions", target: 'a[href="/upload"]', icon: <Upload size={18} />, title: "Ekstre yükle", body: "PDF, CSV ya da Excel at; ben okuyup her işlemi çıkarırım — tek bir şey yazman gerekmez.", action: "Yüklemek için buraya tıkla" },
      { id: "networth", route: "/networth", target: '[data-tour="networth"]', icon: <Scale size={18} />, title: "Net Değer", body: "Sahip olduğun ve borçlu olduğun her şeyi takip et — varlıklar, borçlar ve alacaklar — gerçek net değerini burada gör.", action: "Başlamak için 'Varlık Ekle'yi kullan" },
      { id: "reports", route: "/reports", target: 'a[href="/reports"]', icon: <FileText size={18} />, title: "Raporlar", body: "Finansını, herhangi bir dönem için yazdırabileceğin ya da PDF, CSV ve Excel'e aktarabileceğin temiz bir tabloya dönüştür.", pro: true },
      { id: "simulator", route: "/simulator", target: '[data-tour="simulator"]', icon: <Sparkles size={18} />, title: "Simülatör", body: "\"Daha çok biriktirsem?\" ya da \"bu krediyi erken kapatsam?\" diye sor — geleceğine etkisini sade dille gör.", pro: true },
      { id: "progress", route: "/progress", target: 'a[href="/progress"]', icon: <BarChart2 size={18} />, title: "İlerleme", body: "Finansal sağlık skorun ve net değerinin zaman içindeki seyri — daha iyiye gidip gitmediğini gör." },
      { id: "assistant", route: "/progress", target: '[data-tour="assistant"]', title: "Her zaman buradayım", body: "Herhangi bir sayfadan bana dokun ve paranı sor — bir harcamayı kategorile, varlık ekle ya da tavsiye al.", action: "Sohbet için bana dokun" },
      { id: "summary", route: "/home", target: null, title: "Hazırsın 🎉", body: "" },
    ];
  }
  return [
    { id: "welcome", route: "/home", target: null, title: "Welcome to Clarifin 👋", body: "I'm Clar. Let me give you a quick 60-second tour so you know where everything is." },
    { id: "home", route: "/home", target: '[data-tour="home"]', icon: <Home size={18} />, title: "This is Home", body: "Your daily check-in. I greet you with the one thing that needs your attention and a snapshot of your money." },
    { id: "money", route: "/transactions", target: 'a[href="/transactions"]', icon: <BarChart2 size={18} />, title: "Money Flow", body: "Every transaction, upcoming payment and subscription — in one place. The tabs switch between Activity, Upcoming and Recurring.", action: "Tap here to open it" },
    { id: "upload", route: "/transactions", target: 'a[href="/upload"]', icon: <Upload size={18} />, title: "Upload a statement", body: "Drop in a PDF, CSV or Excel and I'll read it — pulling out every transaction so you don't type a thing.", action: "Click here to upload" },
    { id: "networth", route: "/networth", target: '[data-tour="networth"]', icon: <Scale size={18} />, title: "Net Worth", body: "Track everything you own and owe — assets, debts and receivables — and watch your real net worth here.", action: "Use 'Add asset' to start" },
    { id: "reports", route: "/reports", target: 'a[href="/reports"]', icon: <FileText size={18} />, title: "Reports", body: "Turn your finances into a clean statement you can print or export to PDF, CSV and Excel — for any period.", pro: true },
    { id: "simulator", route: "/simulator", target: '[data-tour="simulator"]', icon: <Sparkles size={18} />, title: "Simulator", body: "Ask \"what if I save more?\" or \"what if I pay this loan off early?\" and see the impact on your future, in plain language.", pro: true },
    { id: "progress", route: "/progress", target: 'a[href="/progress"]', icon: <BarChart2 size={18} />, title: "Progress", body: "Your financial health score and how your net worth trends over time — so you can see if you're getting better." },
    { id: "assistant", route: "/progress", target: '[data-tour="assistant"]', title: "I'm always here", body: "Tap me from any page to ask about your money — categorize a charge, add an asset, or get advice.", action: "Tap me to chat anytime" },
    { id: "summary", route: "/home", target: null, title: "You're all set 🎉", body: "" },
  ];
}

export default function ClarTour() {
  const { lang } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const tr = lang === "tr";
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";

  const [mode, setMode] = useState<Mode>(null);
  const [plan, setPlan] = useState<Plan>("free");
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pinned, setPinned] = useState(false);   // settled on a target (or decided centered)

  const modeRef = useRef<Mode>(null);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const steps = buildSteps(tr);
  const isPro = plan === "pro";

  // ── OFFER / UNLOCK decisioning ──
  const evaluate = useCallback(() => {
    if (typeof window === "undefined") return;
    const user = getStoredUser();
    if (!user || HIDDEN.has(pathname)) {
      if (modeRef.current !== "tour" && modeRef.current !== "unlock") setMode(null);
      return;
    }
    const p = (user.plan as Plan) || "free";
    setPlan(p);
    let seen = localStorage.getItem(SEEN_PLAN);
    if (seen === null) { localStorage.setItem(SEEN_PLAN, p); seen = p; }

    let desired: Mode = null;
    if (rank(p) > rank(seen)) desired = "unlock";
    else if (!localStorage.getItem(TOUR_DONE) && pathname === "/home") desired = "offer";

    const cur = modeRef.current;
    if (cur === "tour" && desired !== "unlock") return;     // don't interrupt an active tour
    if (cur === "unlock" && desired !== "unlock") return;
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

  // ── TOUR engine: navigate to the step's page, then locate + spotlight its target ──
  useEffect(() => {
    if (mode !== "tour") return;
    const stp = steps[step];
    if (!stp) return;

    // 1) Make sure we're on the right page.
    if (stp.route && pathname !== stp.route) {
      setPinned(false);
      setRect(null);
      router.push(stp.route);
      return; // effect re-runs once pathname updates
    }

    // 2) Centered step (welcome / summary / fallback) — no target to find.
    if (!stp.target) { setRect(null); setPinned(true); return; }

    // 3) Poll for the target (pages load data async), then spotlight it.
    setPinned(false);
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const el = findVisible(stp.target!);
      if (el) {
        try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* */ }
        window.setTimeout(() => {
          if (cancelled) return;
          const r = el.getBoundingClientRect();
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          setPinned(true);
        }, 280);
        return;
      }
      if (tries++ < 45) window.setTimeout(tick, 100);
      else { setRect(null); setPinned(true); }   // give up → centered fallback
    };
    tick();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step, pathname]);

  // Keep the spotlight glued to the element on scroll / resize.
  useEffect(() => {
    if (mode !== "tour") return;
    const stp = steps[step];
    if (!stp?.target) return;
    const upd = () => {
      const el = findVisible(stp.target!);
      if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.top, left: r.left, width: r.width, height: r.height }); }
    };
    window.addEventListener("scroll", upd, true);
    window.addEventListener("resize", upd);
    return () => { window.removeEventListener("scroll", upd, true); window.removeEventListener("resize", upd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step]);

  const startTour = () => { setStep(0); setRect(null); setPinned(false); setMode("tour"); };
  const finishTour = () => { try { localStorage.setItem(TOUR_DONE, "1"); } catch { /* */ } setMode(null); };
  const dismissUnlock = () => {
    try { localStorage.setItem(SEEN_PLAN, plan); localStorage.setItem(TOUR_DONE, "1"); } catch { /* */ }
    setMode(null);
  };
  const next = () => setStep((i) => Math.min(steps.length - 1, i + 1));
  const back = () => setStep((i) => Math.max(0, i - 1));

  if (mode === null) return null;

  // ════════════════════════════ OFFER ════════════════════════════
  if (mode === "offer") {
    return (
      <div className="fixed z-[70] bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm" style={{ animation: "clarIn .35s ease both" }}>
        <Style />
        <div className="rounded-2xl border border-line shadow-2xl shadow-black/20 p-4" style={{ backgroundColor: surfaceBg }}>
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <span className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(23,107,91,0.25), transparent 70%)", transform: "scale(1.5)" }} />
              <Mim size={44} mood="happy" speaking />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-ink text-sm font-semibold">{tr ? "Ben Clar 👋" : "I'm Clar 👋"}</p>
              <p className="text-ink-soft text-sm mt-0.5 leading-relaxed">
                {tr ? "Sana 60 saniyede her şeyi gezdireyim mi?" : "Want a quick 60-second tour of what's here?"}
              </p>
            </div>
            <button onClick={finishTour} aria-label="Close" className="shrink-0 text-ink-mute hover:text-ink-soft transition-colors"><XIcon size={16} /></button>
          </div>
          <div className="flex items-center gap-2 mt-3.5">
            <button onClick={startTour} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
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

  // ════════════════════════════ UNLOCK ════════════════════════════
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
      <CenteredCard surfaceBg={surfaceBg} onClose={dismissUnlock}>
        <div className="text-center">
          <ClarHead mood="happy" />
          <h2 className="text-xl font-bold text-ink mt-4">{tr ? `${planName} aktif! 🎉` : `You're on ${planName} now! 🎉`}</h2>
          <p className="text-ink-soft text-sm mt-1.5 leading-relaxed">{tr ? "Yeni açtığın özellikler:" : "Here's what you just unlocked:"}</p>
        </div>
        <ul className="mt-5 space-y-2.5 text-left">
          {feats.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-ink-soft">
              <CheckCircle size={17} className="text-[#176B5B] shrink-0 mt-0.5" /><span>{f}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 mt-6">
          <Link href={exploreRoute} onClick={dismissUnlock} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
            {tr ? "Keşfet" : "Explore"} <ArrowRight size={15} />
          </Link>
          <button onClick={dismissUnlock} className="px-4 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors">
            {tr ? "Tamam" : "Done"}
          </button>
        </div>
      </CenteredCard>
    );
  }

  // ════════════════════════════ TOUR ════════════════════════════
  const stp = steps[step];
  const total = steps.length;
  const isWelcome = step === 0;
  const isSummary = step === total - 1;
  const locked = !!stp.pro && !isPro;
  const progressPct = (step / (total - 1)) * 100;

  // Shared footer (Back / progress / Next / Skip).
  const Footer = ({ nextLabel, onNext }: { nextLabel: string; onNext: () => void }) => (
    <div className="mt-5">
      <div className="h-1 rounded-full bg-surface-2 overflow-hidden mb-3.5">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progressPct}%`, backgroundColor: "#176B5B" }} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <button onClick={finishTour} className="text-ink-mute hover:text-ink-soft text-xs font-medium transition-colors">
          {tr ? "Turu geç" : "Skip tour"}
        </button>
        <div className="flex items-center gap-2">
          {step > 0 && !isSummary && (
            <button onClick={back} className="px-3 py-2 rounded-lg border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors">
              {tr ? "Geri" : "Back"}
            </button>
          )}
          <button onClick={onNext} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
            {nextLabel} <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  // ── WELCOME (centered) ──
  if (isWelcome) {
    return (
      <CenteredCard surfaceBg={surfaceBg} onClose={finishTour} dim>
        <div className="text-center">
          <ClarHead mood="happy" />
          <h2 className="text-xl font-bold text-ink mt-4">{stp.title}</h2>
          <p className="text-ink-soft text-sm mt-2 leading-relaxed max-w-sm mx-auto">{stp.body}</p>
        </div>
        <Footer nextLabel={tr ? "Hadi başlayalım" : "Let's go"} onNext={next} />
      </CenteredCard>
    );
  }

  // ── SUMMARY (centered) + CTA ──
  if (isSummary) {
    const recap = tr
      ? ["Ekstre yükle, ben okuyayım", "Tüm net değerini takip et", "Paranın nereye gittiğini gör"]
      : ["Upload statements and I'll read them", "Track your full net worth", "See where your money goes"];
    const proLine = isPro
      ? (tr ? "Rapor üret ve senaryoları çalıştır" : "Run reports and simulations")
      : (tr ? "Pro ile rapor ve simülatörün kilidini aç" : "Unlock reports & the simulator with Pro");
    return (
      <CenteredCard surfaceBg={surfaceBg} onClose={finishTour} dim>
        <div className="text-center">
          <ClarHead mood="happy" />
          <h2 className="text-xl font-bold text-ink mt-4">{stp.title}</h2>
          <p className="text-ink-soft text-sm mt-1.5">{tr ? "Artık yapabileceklerin:" : "Here's what you can do:"}</p>
        </div>
        <ul className="mt-4 space-y-2.5 text-left">
          {recap.map((r) => (
            <li key={r} className="flex items-start gap-2.5 text-sm text-ink-soft">
              <CheckCircle size={17} className="text-[#176B5B] shrink-0 mt-0.5" /><span>{r}</span>
            </li>
          ))}
          <li className="flex items-start gap-2.5 text-sm text-ink-soft">
            {isPro
              ? <CheckCircle size={17} className="text-[#176B5B] shrink-0 mt-0.5" />
              : <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />}
            <span>{proLine}</span>
          </li>
        </ul>
        <div className="flex items-center gap-2 mt-6">
          {isPro ? (
            <Link href="/home" onClick={finishTour} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
              {tr ? "Keşfetmeye başla" : "Start exploring"} <ArrowRight size={15} />
            </Link>
          ) : (
            <Link href="/upgrade" onClick={finishTour} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors">
              <Sparkles size={15} /> {tr ? "Pro'ya geç" : "Upgrade to Pro"}
            </Link>
          )}
          <button onClick={finishTour} className="px-4 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors">
            {tr ? "Bitti" : "Done"}
          </button>
        </div>
      </CenteredCard>
    );
  }

  // ── SECTION STEP — spotlight + positioned tooltip (or centered while locating/fallback) ──
  const cardBody = (
    <>
      <div className="flex items-center gap-2.5 mb-2">
        {stp.icon && <span className="w-9 h-9 rounded-xl bg-[#176B5B]/10 text-[#176B5B] flex items-center justify-center shrink-0">{stp.icon}</span>}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h3 className="text-base font-bold text-ink truncate">{stp.title}</h3>
          {stp.pro && <span className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 shrink-0">Pro</span>}
        </div>
        <Mim size={26} mood="calm" quiet className="shrink-0" />
      </div>
      <p className="text-ink-soft text-sm leading-relaxed">{stp.body}</p>

      {stp.action && !locked && (
        <div className="mt-2.5 inline-flex items-center gap-1.5 text-[#176B5B] text-xs font-semibold bg-[#176B5B]/[0.08] rounded-lg px-2.5 py-1.5">
          <ArrowRight size={13} /> {stp.action}
        </div>
      )}

      {locked && (
        <div className="mt-3 rounded-xl border border-[#176B5B]/30 bg-[#176B5B]/[0.06] p-3">
          <p className="text-ink-soft text-xs leading-relaxed mb-2">
            {tr ? "Bu bir Pro özelliği — Pro'ya geçince açılır." : "This is a Pro feature — unlock it by upgrading to Pro."}
          </p>
          <Link href="/upgrade" onClick={finishTour} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#176B5B] hover:text-[#125848] transition-colors">
            <Sparkles size={14} /> {tr ? "Pro'ya geç" : "Upgrade to Pro"} <ArrowRight size={14} />
          </Link>
        </div>
      )}

      <Footer nextLabel={tr ? "İleri" : "Next"} onNext={next} />
    </>
  );

  // Still locating the element → soft dim + a small Clar pulse (brief).
  if (!pinned) {
    return (
      <>
        <Style />
        <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.5)" }} />
        <div className="fixed inset-0 z-[82] flex items-center justify-center pointer-events-none">
          <Mim size={56} mood="thinking" speaking />
        </div>
      </>
    );
  }

  // Located → spotlight ring + tooltip near the element.
  if (rect) {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const W = Math.min(360, vw - 24);
    const GAP = 14, M = 12, EST = 250;
    let side: "top" | "bottom" = "bottom";
    let top = rect.top + rect.height + PAD + GAP;
    if (top + EST > vh - M && rect.top - PAD - GAP - EST > M) { side = "top"; top = rect.top - PAD - GAP - EST; }
    top = Math.max(M, Math.min(top, vh - M - 140));
    let left = rect.left + rect.width / 2 - W / 2;
    left = Math.max(M, Math.min(left, vw - W - M));
    const arrowX = Math.max(18, Math.min(W - 18, rect.left + rect.width / 2 - left));

    return (
      <>
        <Style />
        {/* click-blocker (transparent; spotlight box-shadow provides the dim) */}
        <div className="fixed inset-0 z-[80]" onClick={(e) => e.preventDefault()} />
        {/* spotlight: dim mask + ring around the element */}
        <div
          className="fixed z-[81] pointer-events-none"
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            borderRadius: 14,
            boxShadow: "0 0 0 9999px rgba(15,16,14,0.62), 0 0 0 2px #176B5B",
            transition: "top .3s ease, left .3s ease, width .3s ease, height .3s ease",
          }}
        />
        {/* radar pulse on the ring */}
        <div
          className="fixed z-[81] pointer-events-none"
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            borderRadius: 14, animation: "clarRing 1.8s ease-out infinite",
          }}
        />
        {/* tooltip card */}
        <div className="fixed z-[82]" style={{ top, left, width: W, animation: "clarPop .25s ease both" }}>
          <div className="relative rounded-2xl border border-line shadow-2xl shadow-black/30 p-4" style={{ backgroundColor: surfaceBg }}>
            <span
              className="absolute w-3 h-3 rotate-45 border-line"
              style={{
                backgroundColor: surfaceBg,
                left: arrowX - 6,
                ...(side === "bottom"
                  ? { top: -6, borderLeft: "1px solid rgb(var(--c-line))", borderTop: "1px solid rgb(var(--c-line))" }
                  : { bottom: -6, borderRight: "1px solid rgb(var(--c-line))", borderBottom: "1px solid rgb(var(--c-line))" }),
              }}
            />
            {cardBody}
          </div>
        </div>
      </>
    );
  }

  // Fallback (target not found) → centered card.
  return (
    <CenteredCard surfaceBg={surfaceBg} onClose={finishTour} dim>
      {cardBody}
    </CenteredCard>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────
function CenteredCard({ children, onClose, surfaceBg, dim }: { children: React.ReactNode; onClose: () => void; surfaceBg: string; dim?: boolean }) {
  return (
    <div className={`fixed inset-0 z-[80] flex items-center justify-center px-4 ${dim ? "bg-black/55" : "bg-black/40"} backdrop-blur-[2px]`} style={{ animation: "clarFade .25s ease both" }} onClick={onClose}>
      <Style />
      <div className="relative w-full max-w-md rounded-2xl border border-line shadow-2xl shadow-black/30 p-6" style={{ animation: "clarPop .3s ease both", backgroundColor: surfaceBg }} onClick={(e) => e.stopPropagation()}>
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
      @keyframes clarRing { 0% { box-shadow: 0 0 0 0 rgba(23,107,91,0.45) } 100% { box-shadow: 0 0 0 12px rgba(23,107,91,0) } }
    `}</style>
  );
}

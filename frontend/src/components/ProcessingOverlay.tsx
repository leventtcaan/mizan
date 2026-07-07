"use client";

import { useEffect, useState } from "react";
import Mim from "@/components/companion/Mim";
import { FileText, CheckCircle, Sparkles, Brain, Layers, RefreshCw } from "@/components/ui/Icons";
import type { Lang } from "@/lib/i18n";

// Animated "what Mim is doing" processing screen, shown while statements upload.
// Drives a plausible step progression on a timer (the backend doesn't stream progress),
// holding on the final step until the run completes. Pure SVG/CSS — no dependencies.
export default function ProcessingOverlay({ lang, fileCount }: { lang: Lang; fileCount: number }) {
  const steps = lang === "tr"
    ? [
        { Icon: FileText, label: "Ekstreni okuyorum", sub: "Sayfaları tarıyor ve metni çıkarıyorum" },
        { Icon: Layers, label: "İşlemleri ayıklıyorum", sub: "Her satırı tarih, tutar ve açıklamaya ayırıyorum" },
        { Icon: Brain, label: "Harcamaları sınıflandırıyorum", sub: "Her işlemi doğru kategoriye yerleştiriyorum" },
        { Icon: RefreshCw, label: "Tekrarlayan ödemeleri buluyorum", sub: "Abonelikleri ve düzenli ödemeleri tespit ediyorum" },
        { Icon: Sparkles, label: "Brifingini hazırlıyorum", sub: "Önemli olanı tek bir okumada topluyorum" },
      ]
    : [
        { Icon: FileText, label: "Reading your statement", sub: "Scanning the pages and pulling out the text" },
        { Icon: Layers, label: "Extracting transactions", sub: "Splitting each line into date, amount and description" },
        { Icon: Brain, label: "Categorizing spending", sub: "Placing every transaction in the right category" },
        { Icon: RefreshCw, label: "Finding recurring charges", sub: "Spotting subscriptions and regular payments" },
        { Icon: Sparkles, label: "Preparing your brief", sub: "Pulling what matters into a single read" },
      ];

  const [step, setStep] = useState(0);
  useEffect(() => {
    // Earlier steps move briskly; the last one is held (it's where the real wait lives).
    if (step >= steps.length - 1) return;
    const id = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), step === 0 ? 1100 : 1600);
    return () => clearTimeout(id);
  }, [step, steps.length]);

  const active = steps[step];
  // Visible progress: advance per step but never claim 100% until we actually route away.
  const pct = step >= steps.length - 1 ? 92 : Math.round(((step + 1) / steps.length) * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-9 sm:px-8 sm:py-10 text-center shadow-sm">
      <style>{`
        @keyframes clfRing { 0% { transform: scale(.65); opacity:.5 } 100% { transform: scale(2); opacity:0 } }
        @keyframes clfShimmer { 0% { transform: translateX(-110%) } 100% { transform: translateX(320%) } }
        @keyframes clfBlink { 0%,80%,100% { opacity:.2 } 40% { opacity:1 } }
        @keyframes clfPop { 0% { transform: scale(.3); opacity:0 } 60% { transform: scale(1.18) } 100% { transform: scale(1); opacity:1 } }
        @keyframes clfRowIn { from { opacity:0; transform: translateY(7px) } to { opacity:1; transform:none } }
        @keyframes clfFloatY { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
      `}</style>

      {/* soft top wash */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28" style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(23,107,91,0.12), transparent 70%)" }} />

      {/* Mim, haloed by pulsing rings + a couple of drifting motes */}
      <div className="relative mx-auto mb-5 flex items-center justify-center" style={{ width: 132, height: 132 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="absolute rounded-full"
            style={{
              width: 92, height: 92, border: "1.5px solid rgba(23,107,91,0.5)",
              animation: `clfRing ${2.8}s ease-out ${i * 0.9}s infinite`,
            }} />
        ))}
        <span className="absolute rounded-full" style={{ width: 6, height: 6, background: "#176B5B", top: 10, left: 24, opacity: 0.7, animation: "clfFloatY 3.2s ease-in-out infinite" }} />
        <span className="absolute rounded-full" style={{ width: 4, height: 4, background: "#176B5B", bottom: 16, right: 22, opacity: 0.6, animation: "clfFloatY 2.6s ease-in-out .6s infinite" }} />
        <Mim mood="thinking" size={92} speaking />
      </div>

      {/* Mim narrates the current step */}
      <p className="text-ink font-semibold text-lg leading-snug">{active.label}</p>
      <p className="text-ink-mute text-sm mt-1 max-w-xs mx-auto">{active.sub}</p>
      {fileCount > 1 && (
        <p className="text-ink-mute text-xs mt-2">
          {lang === "tr" ? `${fileCount} ekstre işleniyor` : `Processing ${fileCount} statements`}
        </p>
      )}

      {/* Step checklist */}
      <div className="mt-7 space-y-2 text-left max-w-sm mx-auto">
        {steps.map((s, i) => {
          const done = i < step;
          const isActive = i === step;
          const StepIcon = s.Icon;
          return (
            <div key={i}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                isActive ? "bg-[#176B5B]/[0.07] border border-[#176B5B]/25" : "border border-transparent"
              }`}
              style={{ animation: `clfRowIn .4s ease ${i * 0.06}s both` }}
            >
              <span className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                done ? "text-white" : isActive ? "text-[#176B5B]" : "text-ink-mute"
              }`}
                style={done ? { backgroundColor: "#176B5B" } : isActive ? { boxShadow: "0 0 0 1.5px rgba(23,107,91,0.4) inset" } : { boxShadow: "0 0 0 1.5px rgb(var(--c-line)) inset" }}
              >
                {done ? (
                  <span style={{ animation: "clfPop .35s ease both" }}><CheckCircle size={16} /></span>
                ) : (
                  <StepIcon size={15} className={isActive ? "animate-pulse" : ""} />
                )}
              </span>
              <span className={`flex-1 text-sm ${done ? "text-ink-soft" : isActive ? "text-ink font-medium" : "text-ink-mute"}`}>
                {s.label}
              </span>
              {isActive && (
                <span className="flex items-center gap-1 shrink-0">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#176B5B", animation: `clfBlink 1.1s ease-in-out ${d * 0.18}s infinite` }} />
                  ))}
                </span>
              )}
              {done && <CheckCircle size={15} className="text-pos shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Indeterminate-yet-advancing progress bar with a moving shimmer */}
      <div className="relative mt-7 h-1.5 rounded-full bg-surface-2 overflow-hidden max-w-sm mx-auto">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: "#176B5B" }} />
        <div className="absolute inset-y-0 w-1/3" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)", animation: "clfShimmer 1.5s linear infinite" }} />
      </div>
    </div>
  );
}

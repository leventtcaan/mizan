"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getToken, getStoredUser } from "@/lib/api";
import {
  Brain, BarChart2, Target, RefreshCw, TrendingUp, ShieldCheck,
  FileText, MessageSquare, ArrowRight, Zap,
} from "@/components/ui/Icons";

const FEATURES = [
  {
    icon: Brain,
    title: "Davranışsal Koçluk",
    desc: "Sadece grafik değil, neden harcadığınızı anlayın. AI koçunuz her zaman hazır.",
  },
  {
    icon: BarChart2,
    title: "Aylık Karşılaştırma",
    desc: "Geçen aya göre ilerlemenizi takip edin. Her kategori için gerçek değişimi görün.",
  },
  {
    icon: Target,
    title: "Hedef Yönetimi",
    desc: "Kategori bazlı aylık bütçe hedefleri koyun, aşımlarda uyarı alın.",
  },
  {
    icon: RefreshCw,
    title: "Abonelik Takibi",
    desc: "Unuttuğunuz abonelikleri otomatik tespit edin. Tasarruf potansiyelinizi görün.",
  },
  {
    icon: TrendingUp,
    title: "Enflasyon Analizi",
    desc: "Gerçek harcama artışınızı TÜFE ile karşılaştırın. Nominal değil, gerçek değişim.",
  },
  {
    icon: ShieldCheck,
    title: "Gizlilik Önce",
    desc: "Verileriniz sizin. Hiçbir banka API'si, hiçbir üçüncü taraf paylaşımı.",
  },
];

const STEPS = [
  {
    icon: FileText,
    title: "Ekstrenizi Yükleyin",
    desc: "Ziraat, Garanti, Yapı Kredi, VakıfBank ve diğerlerinden PDF veya CSV.",
    step: "01",
  },
  {
    icon: Zap,
    title: "AI Analiz Eder",
    desc: "İşlemleriniz saniyeler içinde kategorize edilir, davranış desenleri çıkarılır.",
    step: "02",
  },
  {
    icon: MessageSquare,
    title: "Koçunuzla Konuşun",
    desc: "Paranın nereye gittiğini sorun, davranışsal öneriler ve kişisel içgörüler alın.",
    step: "03",
  },
];

const BANKS = ["Ziraat Bankası", "VakıfBank", "Yapı Kredi", "Garanti BBVA"];

export default function HomePage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const howRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (getToken()) {
      setUserEmail(getStoredUser()?.email ?? null);
    }
  }, []);

  const isLoggedIn = userEmail !== null;

  return (
    <main className="min-h-screen bg-[#0F0F0F] text-white overflow-x-hidden">

      {/* Nav — landing only, full navbar only shows when logged in */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <span className="text-lg font-bold tracking-tight">Mizan</span>
        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <>
              <span className="text-gray-500 text-xs hidden sm:block truncate max-w-[160px]">{userEmail}</span>
              <Link
                href="/transactions"
                className="px-4 py-2 rounded-lg bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#2A2A2A] text-sm text-gray-300 transition-colors"
              >
                Devam Et
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
            >
              Giriş Yap
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative text-center px-6 pt-16 pb-28 max-w-3xl mx-auto">
        {/* Subtle glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Türkiye&apos;nin ilk davranışsal finans koçu
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
            Paranız nereye
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
              gidiyor?
            </span>
          </h1>

          <p className="text-gray-400 text-lg sm:text-xl leading-relaxed mb-10 max-w-xl mx-auto">
            Banka ekstrenizi yükleyin, yapay zeka harcama koçunuz devreye girsin.
            Türkçe, ücretsiz, verileriniz sizde.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {isLoggedIn ? (
              <>
                <Link
                  href="/transactions"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors"
                >
                  Devam Et <ArrowRight size={18} />
                </Link>
                <Link
                  href="/upload"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#2A2A2A] font-semibold text-gray-300 transition-colors"
                >
                  Ekstre Yükle
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors"
                >
                  Ücretsiz Başla <ArrowRight size={18} />
                </Link>
                <button
                  onClick={() => howRef.current?.scrollIntoView({ behavior: "smooth" })}
                  className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#2A2A2A] font-semibold text-gray-300 transition-colors"
                >
                  Nasıl Çalışır
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section ref={howRef} className="border-t border-[#1A1A1A] py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-gray-500 text-xs uppercase tracking-widest mb-4">Nasıl Çalışır</p>
          <h2 className="text-3xl font-bold text-center mb-16">Üç adımda başlayın</h2>
          <div className="grid sm:grid-cols-3 gap-8 relative">
            {/* Connector line desktop */}
            <div className="hidden sm:block absolute top-8 left-[calc(16.66%+1rem)] right-[calc(16.66%+1rem)] h-px bg-gradient-to-r from-transparent via-[#2A2A2A] to-transparent" />
            {STEPS.map((step) => (
              <div key={step.step} className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="relative mb-5">
                    <div className="w-16 h-16 rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center">
                      <step.icon size={24} className="text-indigo-400" />
                    </div>
                    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {step.step.slice(1)}
                    </span>
                  </div>
                  <h3 className="font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6 bg-[#0A0A0A]">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-gray-500 text-xs uppercase tracking-widest mb-4">Özellikler</p>
          <h2 className="text-3xl font-bold text-center mb-16">Her şey bir arada</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group bg-[#1A1A1A] border border-[#2A2A2A] hover:border-indigo-800/60 rounded-xl p-5 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-900/50 flex items-center justify-center mb-4 group-hover:bg-indigo-900/50 transition-colors">
                  <f.icon size={20} className="text-indigo-400" />
                </div>
                <h3 className="font-semibold text-white mb-1.5">{f.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Banks */}
      <section className="py-16 px-6 border-t border-[#1A1A1A]">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-6">Desteklenen Bankalar</p>
          <div className="flex flex-wrap justify-center gap-3">
            {BANKS.map((bank) => (
              <span
                key={bank}
                className="px-4 py-2 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] text-gray-300 text-sm font-medium"
              >
                {bank}
              </span>
            ))}
          </div>
          <p className="text-gray-600 text-xs mt-4">PDF veya CSV formatındaki tüm bankalar desteklenir</p>
        </div>
      </section>

      {/* CTA */}
      {!isLoggedIn && (
        <section className="py-28 px-6 text-center relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-950/10 to-transparent pointer-events-none" />
          <div className="relative">
            <h2 className="text-4xl font-bold mb-4">Bugün başlayın</h2>
            <p className="text-gray-400 mb-8 text-lg">Kayıt olmak 30 saniye sürer. Kredi kartı gerekmez.</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-base transition-colors"
            >
              Ücretsiz Başla <ArrowRight size={20} />
            </Link>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-[#1A1A1A] py-8 px-6 text-center text-gray-600 text-sm">
        © 2026 Mizan · Gizlilik Politikası · İletişim
      </footer>
    </main>
  );
}

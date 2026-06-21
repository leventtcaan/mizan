"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getToken, getStoredUser } from "@/lib/api";

export default function HomePage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const howRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (getToken()) {
      setUserEmail(getStoredUser()?.email ?? null);
    }
  }, []);

  const isLoggedIn = userEmail !== null;

  const scrollToHow = () => {
    howRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto">
        <span className="text-xl font-bold tracking-tight">Mizan</span>
        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <>
              <span className="text-gray-500 text-xs hidden sm:block">{userEmail}</span>
              <Link
                href="/transactions"
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
              >
                Devam Et →
              </Link>
              <Link
                href="/upload"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
              >
                Ekstre Yükle
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
      <section className="text-center px-6 pt-20 pb-24 max-w-3xl mx-auto">
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
          Paranız nereye
          <span className="text-indigo-400"> gidiyor?</span>
        </h1>
        <p className="text-gray-400 text-lg sm:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
          Banka ekstrenizi yükleyin, yapay zeka harcama koçunuz devreye girsin.
          <br className="hidden sm:block" />
          <span className="text-gray-500">Türkçe, ücretsiz, verileriniz sizde.</span>
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {isLoggedIn ? (
            <>
              <Link
                href="/transactions"
                className="px-8 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-base transition-colors"
              >
                Devam Et →
              </Link>
              <Link
                href="/upload"
                className="px-8 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 font-semibold text-base transition-colors text-gray-300"
              >
                Ekstre Yükle
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-8 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-base transition-colors"
              >
                Ücretsiz Başla →
              </Link>
              <button
                onClick={scrollToHow}
                className="px-8 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 font-semibold text-base transition-colors text-gray-300"
              >
                Nasıl Çalışır ↓
              </button>
            </>
          )}
        </div>
      </section>

      {/* How it works */}
      <section ref={howRef} className="bg-gray-900 py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Nasıl Çalışır?</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: "📄",
                title: "Ekstrenizi Yükleyin",
                desc: "Ziraat, Garanti, Yapı Kredi, VakıfBank ve daha fazlası",
              },
              {
                icon: "🤖",
                title: "AI Analiz Eder",
                desc: "İşlemleriniz kategorize edilir, harcama desenleriniz çıkarılır",
              },
              {
                icon: "💬",
                title: "Koçunuzla Konuşun",
                desc: "Paranın nereye gittiğini sorun, davranışsal öneriler alın",
              },
            ].map((step, i) => (
              <div key={i} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center text-2xl mx-auto mb-4">
                  {step.icon}
                </div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-900 text-indigo-400 text-xs flex items-center justify-center font-bold">
                    {i + 1}
                  </span>
                  <h3 className="font-semibold text-white">{step.title}</h3>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Neler Yapabilirsiniz?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: "🧠",
                title: "Davranışsal Koçluk",
                desc: "Sadece grafik değil, neden harcadığınızı anlayın",
              },
              {
                icon: "📊",
                title: "Aylık Karşılaştırma",
                desc: "Geçen aya göre ilerlemenizi takip edin",
              },
              {
                icon: "🎯",
                title: "Hedef Yönetimi",
                desc: "Kategori bazlı bütçe hedefleri koyun",
              },
              {
                icon: "🔄",
                title: "Abonelik Takibi",
                desc: "Unuttuğunuz abonelikleri bulun",
              },
              {
                icon: "📈",
                title: "Enflasyon Analizi",
                desc: "Gerçek harcama artışınızı görün",
              },
              {
                icon: "🔒",
                title: "Gizlilik Önce",
                desc: "Verileriniz sadece sizin",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
              >
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-white mb-1">{f.title}</h3>
                <p className="text-gray-400 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bank logos */}
      <section className="bg-gray-900 py-14 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-gray-500 text-sm mb-6 uppercase tracking-wider">Desteklenen Bankalar</p>
          <div className="flex flex-wrap justify-center gap-6">
            {["Ziraat Bankası", "VakıfBank", "Yapı Kredi", "Garanti BBVA"].map((bank) => (
              <span
                key={bank}
                className="px-5 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-sm font-medium"
              >
                {bank}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      {!isLoggedIn && (
        <section className="py-24 px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Bugün başlayın</h2>
          <p className="text-gray-400 mb-8">Kayıt olmak 30 saniye sürer. Kredi kartı gerekmez.</p>
          <Link
            href="/login"
            className="inline-block px-10 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-base transition-colors"
          >
            Ücretsiz Başla →
          </Link>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8 px-6 text-center text-gray-600 text-sm">
        © 2026 Mizan · Gizlilik Politikası · İletişim
      </footer>
    </main>
  );
}

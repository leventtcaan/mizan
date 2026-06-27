"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

export default function PrivacyPage() {
  const { lang } = useLanguage();
  const tr = lang === "tr";
  const sections = tr
    ? [
        ["Topladığımız veriler", "Hesap bilgilerin (e-posta, isteğe bağlı ad, ülke), tercihlerin ve Clarifin'a eklediğin finansal veriler (yüklediğin ekstreler, eklediğin varlık/borçlar)."],
        ["Neden", "Veriyi yalnızca sana hizmeti sunmak için kullanırız: paranı analiz etmek, panonu kişiselleştirmek ve (onay verdiysen) bilgilendirme e-postaları göndermek."],
        ["Yapay zeka işleme", "Ekstre analizleri için içerik, üçüncü taraf yapay zeka sağlayıcılarına (ör. DeepSeek, OpenAI) gönderilebilir ve yurt dışında işlenebilir. Yalnızca analiz için gereken veriyi paylaşırız."],
        ["Haklarınız (GDPR / KVKK)", "Verilerine erişme, düzeltme, silme (unutulma hakkı) ve pazarlama onayını geri çekme hakkına sahipsin. Hesabını sildiğinde verilerin kaldırılır."],
        ["Pazarlama", "Pazarlama e-postaları yalnızca açık onay verdiysen gönderilir ve istediğin zaman çıkabilirsin."],
        ["Güvenlik", "Banka girişi istemeyiz. Verilerin aktarımda şifrelenir; erişim sınırlıdır."],
      ]
    : [
        ["What we collect", "Account details (email, optional name, country), your preferences, and the financial data you add to Clarifin (statements you upload, assets/debts you enter)."],
        ["Why", "We use data only to provide the service to you: analyzing your money, personalizing your dashboard, and (if you opted in) sending informational emails."],
        ["AI processing", "To analyze statements, content may be sent to third-party AI providers (e.g. DeepSeek, OpenAI) and processed outside your country. We share only what the analysis requires."],
        ["Your rights (GDPR / KVKK)", "You can access, correct, and delete your data (right to erasure), and withdraw marketing consent at any time. Deleting your account removes your data."],
        ["Marketing", "Marketing emails are sent only if you explicitly opt in, and you can unsubscribe anytime."],
        ["Security", "We never ask for your bank login. Your data is encrypted in transit and access is restricted."],
      ];

  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/login" className="text-ink-mute text-sm hover:text-ink-soft transition-colors">← Clarifin</Link>
        <h1 className="text-3xl font-bold mt-6 mb-1">{tr ? "Gizlilik Politikası" : "Privacy Policy"}</h1>
        <p className="text-ink-mute text-sm mb-8">{tr ? "Verilerini ciddiye alıyoruz." : "We take your data seriously."}</p>
        <div className="space-y-6">
          {sections.map(([h, b]) => (
            <section key={h}>
              <h2 className="text-base font-semibold text-ink mb-1.5">{h}</h2>
              <p className="text-ink-soft text-sm leading-relaxed">{b}</p>
            </section>
          ))}
        </div>
        <p className="text-ink-mute text-xs mt-10">
          {tr ? "Veri talepleri için: " : "Data requests: "}<span className="text-ink-soft">privacy@clarifin.app</span>
        </p>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n";
import { TOS_VERSION } from "@/lib/api";

export default function TermsPage() {
  const { lang } = useLanguage();
  const tr = lang === "tr";
  const sections = tr
    ? [
        ["Hizmet", "Mizan, finansal verilerini tek bir yerde toplaman ve anlamlandırman için bir araçtır. Bir banka, yatırım danışmanı veya muhasebeci değildir; sunulan içerik bilgilendirme amaçlıdır, yatırım tavsiyesi değildir."],
        ["Hesabın", "Hesabını ve şifreni korumaktan sen sorumlusun. Verdiğin bilgilerin doğru olması gerekir. İstediğin zaman hesabını kapatabilirsin."],
        ["Kabul edilebilir kullanım", "Mizan'ı yasalara aykırı veya başkalarının haklarını ihlal eden şekilde kullanmamayı kabul edersin."],
        ["Sorumluluk", "Hizmet 'olduğu gibi' sunulur. Finansal kararların sorumluluğu sana aittir. Mizan, dolaylı zararlardan sorumlu tutulamaz."],
        ["Değişiklikler", "Bu koşulları zaman zaman güncelleyebiliriz; önemli değişikliklerde seni bilgilendiririz."],
      ]
    : [
        ["The service", "Mizan is a tool to bring your financial data together and make sense of it. It is not a bank, investment advisor, or accountant; content is informational and is not financial advice."],
        ["Your account", "You're responsible for keeping your account and password secure, and for the accuracy of the information you provide. You can close your account at any time."],
        ["Acceptable use", "You agree not to use Mizan for anything unlawful or that infringes the rights of others."],
        ["Liability", "The service is provided “as is”. You are responsible for your financial decisions. Mizan is not liable for indirect damages."],
        ["Changes", "We may update these terms from time to time and will notify you of material changes."],
      ];

  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/login" className="text-ink-mute text-sm hover:text-ink-soft transition-colors">← Mizan</Link>
        <h1 className="text-3xl font-bold mt-6 mb-1">{tr ? "Kullanım Koşulları" : "Terms of Service"}</h1>
        <p className="text-ink-mute text-sm mb-8">{tr ? "Sürüm" : "Version"} {TOS_VERSION}</p>
        <div className="space-y-6">
          {sections.map(([h, b]) => (
            <section key={h}>
              <h2 className="text-base font-semibold text-ink mb-1.5">{h}</h2>
              <p className="text-ink-soft text-sm leading-relaxed">{b}</p>
            </section>
          ))}
        </div>
        <p className="text-ink-mute text-xs mt-10">
          {tr ? "Sorular için: " : "Questions: "}<span className="text-ink-soft">support@mizan.app</span>
        </p>
      </div>
    </main>
  );
}

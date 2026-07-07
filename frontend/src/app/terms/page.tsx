"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n";
import { TOS_VERSION } from "@/lib/api";

export default function TermsPage() {
  const { lang } = useLanguage();
  const tr = lang === "tr";
  const sections: [string, string][] = tr
    ? [
        ["Hizmet nedir", "Clarifin, banka ekstrelerini (PDF, CSV, Excel) yükleyerek veya elle veri girerek tüm finansal durumunu — harcamalar, net değer, tekrarlayan ödemeler, alacaklar — tek yerde görmeni sağlayan bir araçtır. Banka hesabına BAĞLANMAYIZ; yalnızca senin yüklediğin veya girdiğin verileri işleriz."],
        ["Finansal tavsiye değildir", "Clarifin bir banka, ödeme kuruluşu, yatırım danışmanı veya muhasebeci değildir. Uygulamadaki analizler, skorlar, simülasyonlar ve Clar'ın yorumları bilgilendirme amaçlıdır; yatırım, vergi veya hukuk tavsiyesi değildir. Finansal kararlarının sorumluluğu sana aittir."],
        ["Yapay zekâ ile işleme", "Ekstre okuma, kategorilendirme ve yorumlar için yapay zekâ modelleri kullanırız (bkz. Gizlilik Politikası). Yapay zekâ hata yapabilir: çıkarılan işlemleri kaydetmeden önce sana gözden geçirtiriz, yine de tutarları kendi kayıtlarınla doğrulamak senin sorumluluğundadır."],
        ["Hesabın", "Hesabını ve şifreni korumaktan sen sorumlusun. Verdiğin bilgilerin doğru olması gerekir. Hesabını istediğin zaman Ayarlar'dan silebilirsin: hesap anında devre dışı kalır ve 30 gün içinde geri getirilmezse tüm verilerinle birlikte kalıcı olarak silinir."],
        ["Planlar ve ödeme", "Ücretsiz plan sınırlı özellik sunar; Plus ve Pro planları aylık veya yıllık aboneliktir. Ödemeler, kayıtlı satıcı (Merchant of Record) olarak Paddle üzerinden alınır — kart bilgilerin bize hiç ulaşmaz. Aboneliğini istediğin zaman iptal edebilirsin; iptal dönem sonunda geçerli olur. Ücret iadeleri Paddle'ın satın alma koşullarına tabidir."],
        ["Kabul edilebilir kullanım", "Clarifin'i yasalara aykırı şekilde, başkalarının verilerini izinsiz yükleyerek veya sistemin güvenliğini bozmaya çalışarak kullanmamayı kabul edersin. Aksi durumda hesabını askıya alabilir veya kapatabiliriz."],
        ["Sorumluluğun sınırı", "Hizmet 'olduğu gibi' sunulur. Kesintisiz veya hatasız çalışacağını garanti etmeyiz. Yürürlükteki yasaların izin verdiği azami ölçüde, Clarifin dolaylı veya sonuçsal zararlardan sorumlu tutulamaz; toplam sorumluluğumuz son 12 ayda ödediğin ücretle sınırlıdır."],
        ["Değişiklikler", "Bu koşulları zaman zaman güncelleyebiliriz. Önemli değişikliklerde e-posta veya uygulama içi bildirimle haber veririz; kullanmaya devam etmen yeni koşulları kabul ettiğin anlamına gelir."],
      ]
    : [
        ["What the service is", "Clarifin is a tool that lets you see your complete financial picture — spending, net worth, recurring charges, receivables — in one place, by uploading bank statements (PDF, CSV, Excel) or entering data manually. We do NOT connect to your bank account; we only process data you upload or enter yourself."],
        ["Not financial advice", "Clarifin is not a bank, payment institution, investment advisor, or accountant. The analyses, scores, simulations and Clar's commentary are informational only — not investment, tax or legal advice. You are responsible for your financial decisions."],
        ["AI processing", "We use AI models to read statements, categorize transactions and generate commentary (see the Privacy Policy). AI can make mistakes: we ask you to review extracted transactions before they're saved, and it remains your responsibility to verify amounts against your own records."],
        ["Your account", "You're responsible for keeping your account and password secure, and for the accuracy of the information you provide. You can delete your account at any time from Settings: it's deactivated immediately and permanently erased with all its data after 30 days unless you restore it."],
        ["Plans and billing", "The free plan offers limited features; Plus and Pro are monthly or yearly subscriptions. Payments are processed by Paddle as Merchant of Record — your card details never reach us. You can cancel anytime; cancellation takes effect at the end of the billing period. Refunds are subject to Paddle's buyer terms."],
        ["Acceptable use", "You agree not to use Clarifin unlawfully, upload other people's data without authorization, or attempt to compromise the service. We may suspend or terminate accounts that do."],
        ["Limitation of liability", "The service is provided “as is”. We don't guarantee uninterrupted or error-free operation. To the maximum extent permitted by law, Clarifin is not liable for indirect or consequential damages, and our total liability is limited to the fees you paid in the last 12 months."],
        ["Changes", "We may update these terms from time to time. We'll notify you of material changes by email or in-app notice; continued use means you accept the new terms."],
      ];

  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-ink-mute text-sm hover:text-ink-soft transition-colors">← Clarifin</Link>
        <h1 className="text-3xl font-bold mt-6 mb-1">{tr ? "Kullanım Koşulları" : "Terms of Service"}</h1>
        <p className="text-ink-mute text-sm mb-8">{tr ? "Sürüm" : "Version"} {TOS_VERSION} · {tr ? "Son güncelleme: 7 Temmuz 2026" : "Last updated: July 7, 2026"}</p>
        <div className="space-y-6">
          {sections.map(([h, b]) => (
            <section key={h}>
              <h2 className="text-base font-semibold text-ink mb-1.5">{h}</h2>
              <p className="text-ink-soft text-sm leading-relaxed">{b}</p>
            </section>
          ))}
        </div>
        <p className="text-ink-mute text-xs mt-10">
          {tr ? "Sorular için: " : "Questions: "}<span className="text-ink-soft">support@clarifin.xyz</span>
          {" · "}
          <Link href="/privacy" className="text-[#176B5B] hover:underline">{tr ? "Gizlilik Politikası" : "Privacy Policy"}</Link>
        </p>
      </div>
    </main>
  );
}

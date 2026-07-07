"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

export default function PrivacyPage() {
  const { lang } = useLanguage();
  const tr = lang === "tr";
  const sections: [string, string][] = tr
    ? [
        ["Topladığımız veriler", "Hesap bilgilerin (e-posta, isteğe bağlı ad, ülke, telefon), tercihlerin (dil, para birimi) ve Clarifin'e senin eklediğin finansal veriler: yüklediğin ekstrelerden çıkarılan işlemler, elle girdiğin işlemler, varlıklar, borçlar ve alacaklar. Banka giriş bilgilerini HİÇBİR ZAMAN istemeyiz ve hesabına bağlanmayız."],
        ["Verini nasıl kullanırız", "Yalnızca hizmeti sunmak için: ekstrelerini okumak, harcamalarını kategorilendirmek, net değerini hesaplamak, panonu kişiselleştirmek ve (açıksa) haftalık özet e-postası göndermek. Verini reklam için kullanmayız ve üçüncü taraflara satmayız."],
        ["Nerede saklanır", "Verilerin, Avrupa Birliği'nde (Almanya) barındırılan sunucularımızdaki şifrelenmiş bir veritabanında saklanır. Aktarım sırasında TLS ile şifrelenir; erişim yalnızca hizmeti işletmek için gereken sistemlerle sınırlıdır."],
        ["Yapay zekâ alt işleyicileri", "Ekstre okuma, kategorilendirme ve yorumlar için ekstre içeriği üçüncü taraf yapay zekâ sağlayıcılarına — DeepSeek (ekstre analizi ve kategorilendirme) ve OpenAI (görsel PDF okuma ve bazı analizler) — gönderilebilir ve yurt dışında işlenebilir. Yalnızca analizin gerektirdiği içeriği paylaşırız; bu sağlayıcılar veriyi kendi modellerini eğitmek için kullanmaz (API kullanım koşulları kapsamında)."],
        ["Ödeme verileri", "Ödemeler Paddle (kayıtlı satıcı) tarafından işlenir. Kart bilgilerin bize hiç ulaşmaz; Paddle'dan yalnızca abonelik durumunu (plan, dönem sonu) alırız. Paddle'ın gizlilik politikası paddle.com adresinde bulunur."],
        ["Diğer alt işleyiciler", "E-posta gönderimi için Resend (doğrulama, şifre sıfırlama, haftalık özet), anonim kullanım istatistikleri için Plausible Analytics (çerezsiz, kişisel veri toplamaz) kullanırız."],
        ["Saklama ve silme", "Verini hesabın açık olduğu sürece saklarız. Hesabını Ayarlar'dan sildiğinde hesap anında devre dışı kalır ve 30 günlük geri getirme penceresinin ardından tüm verilerinle birlikte kalıcı olarak silinir. Bu süre içinde giriş yaparak silmeyi geri alabilirsin."],
        ["Hakların (GDPR / KVKK)", "Verilerine erişme, düzeltme, taşıma (dışa aktarma Raporlar sayfasında hazır), silme (unutulma hakkı) ve pazarlama onayını geri çekme hakkına sahipsin. Talepler için privacy@clarifin.xyz adresine yazabilirsin; kimliğini doğruladıktan sonra 30 gün içinde yanıtlarız."],
        ["Pazarlama", "Pazarlama e-postaları yalnızca kayıt sırasında açık onay verdiysen gönderilir; her e-postadan veya Ayarlar'dan çıkabilirsin. Hizmet e-postaları (doğrulama, şifre sıfırlama) bundan ayrıdır."],
        ["Çerezler", "Oturumun tarayıcının yerel depolamasında tutulur; takip çerezi kullanmayız. Plausible çerezsiz çalışır — bu yüzden çerez bandımız yok."],
      ]
    : [
        ["What we collect", "Account details (email, optional name, country, phone), your preferences (language, currency), and the financial data YOU add to Clarifin: transactions extracted from statements you upload, manual entries, assets, debts and receivables. We NEVER ask for your bank login and never connect to your bank account."],
        ["How we use it", "Only to provide the service: reading your statements, categorizing spending, computing your net worth, personalizing your dashboard, and (if enabled) sending the weekly brief email. We don't use your data for advertising and never sell it."],
        ["Where it lives", "Your data is stored in an encrypted database on our servers hosted in the European Union (Germany). It's encrypted in transit with TLS, and access is restricted to the systems needed to run the service."],
        ["AI sub-processors", "To read statements, categorize transactions and generate commentary, statement content may be sent to third-party AI providers — DeepSeek (statement analysis and categorization) and OpenAI (image-PDF reading and some analyses) — and processed outside your country. We share only the content the analysis requires; under their API terms these providers don't use it to train their models."],
        ["Payment data", "Payments are processed by Paddle as Merchant of Record. Your card details never reach us; we only receive your subscription status (plan, period end) from Paddle. Paddle's privacy policy is at paddle.com."],
        ["Other sub-processors", "We use Resend for email delivery (verification, password reset, weekly brief) and Plausible Analytics for anonymous usage statistics (cookieless, collects no personal data)."],
        ["Retention and deletion", "We keep your data while your account is active. When you delete your account from Settings, it's deactivated immediately and permanently erased with all its data after a 30-day recovery window. You can undo the deletion by signing in within that window."],
        ["Your rights (GDPR / KVKK)", "You can access, correct, port (export is built into the Reports page), and delete your data (right to erasure), and withdraw marketing consent at any time. Write to privacy@clarifin.xyz — we respond within 30 days after verifying your identity."],
        ["Marketing", "Marketing emails are sent only if you explicitly opted in at registration; you can unsubscribe from any email or in Settings. Service emails (verification, password reset) are separate."],
        ["Cookies", "Your session lives in your browser's local storage; we use no tracking cookies. Plausible is cookieless — which is why there's no cookie banner."],
      ];

  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-ink-mute text-sm hover:text-ink-soft transition-colors">← Clarifin</Link>
        <h1 className="text-3xl font-bold mt-6 mb-1">{tr ? "Gizlilik Politikası" : "Privacy Policy"}</h1>
        <p className="text-ink-mute text-sm mb-8">{tr ? "Son güncelleme: 7 Temmuz 2026" : "Last updated: July 7, 2026"}</p>
        <div className="space-y-6">
          {sections.map(([h, b]) => (
            <section key={h}>
              <h2 className="text-base font-semibold text-ink mb-1.5">{h}</h2>
              <p className="text-ink-soft text-sm leading-relaxed">{b}</p>
            </section>
          ))}
        </div>
        <p className="text-ink-mute text-xs mt-10">
          {tr ? "Veri talepleri için: " : "Data requests: "}<span className="text-ink-soft">privacy@clarifin.xyz</span>
          {" · "}
          <Link href="/terms" className="text-[#176B5B] hover:underline">{tr ? "Kullanım Koşulları" : "Terms of Service"}</Link>
        </p>
      </div>
    </main>
  );
}

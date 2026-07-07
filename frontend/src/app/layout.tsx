import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/ui/Navbar";
import GlobalAssistant from "@/components/GlobalAssistant";
import ClarTour from "@/components/ClarTour";
import HtmlLangSync from "@/components/HtmlLangSync";
import { THEME_BOOTSTRAP } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://clarifin.xyz"),
  title: {
    default: "Clarifin — See all your money in one place",
    template: "%s · Clarifin",
  },
  description:
    "Upload a bank statement and Clarifin reads it in seconds: spending, net worth, recurring charges and what to do next. Any bank, any currency. No account linking.",
  keywords: ["personal finance", "net worth tracker", "bank statement analysis", "money management", "finansal asistan", "harcama takibi"],
  // Explicit so the tab/favicon resolves to the app's "C" monogram (src/app/icon.svg).
  icons: { icon: "/icon.svg" },
  openGraph: {
    type: "website",
    url: "https://clarifin.xyz",
    siteName: "Clarifin",
    title: "Clarifin — See all your money in one place",
    description:
      "Upload a bank statement and Clarifin reads it in seconds: spending, net worth, recurring charges and what to do next. Any bank, any currency.",
    locale: "en_US",
    alternateLocale: ["tr_TR"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Clarifin — See all your money in one place",
    description:
      "Upload a bank statement and Clarifin reads it in seconds: spending, net worth, recurring charges and what to do next.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang here is a server-rendered default; HtmlLangSync updates it to the
    // user's stored choice or detected browser locale after hydration.
    // data-theme is set by the inline bootstrap below before first paint (no FOUC).
    <html lang="tr" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* Plausible — privacy-friendly analytics, no cookies, GDPR-safe (no banner
            needed). The script self-ignores localhost, so it's safe in dev too. */}
        <script defer data-domain="clarifin.xyz" src="https://plausible.io/js/script.js" />
      </head>
      <body className={`${inter.className} bg-canvas text-ink antialiased`}>
        <HtmlLangSync />
        <Navbar />
        {children}
        <GlobalAssistant />
        <ClarTour />
      </body>
    </html>
  );
}

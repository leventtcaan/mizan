import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/ui/Navbar";
import GlobalAssistant from "@/components/GlobalAssistant";
import HtmlLangSync from "@/components/HtmlLangSync";
import { THEME_BOOTSTRAP } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mizan",
  description: "Harcama davranışını anla.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang here is a server-rendered default; HtmlLangSync updates it to the
    // user's stored choice or detected browser locale after hydration.
    // data-theme is set by the inline bootstrap below before first paint (no FOUC).
    <html lang="tr" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${inter.className} bg-canvas text-ink antialiased`}>
        <HtmlLangSync />
        <Navbar />
        {children}
        <GlobalAssistant />
      </body>
    </html>
  );
}

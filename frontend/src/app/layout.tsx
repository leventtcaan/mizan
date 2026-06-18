/**
 * WHAT: Root layout — wraps every page in html/body tags, sets global metadata and fonts.
 * WHY: Next.js App Router requires a root layout; metadata defined here appears on every page.
 * BREAKS IF REMOVED: Next.js build fails — root layout is mandatory in App Router.
 */
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// WHY: next/font/google downloads Inter at build time and self-hosts it.
// No Google Fonts request at runtime — faster load, no privacy leakage to Google.
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mizan",
  description: "Harcama davranışını anla.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

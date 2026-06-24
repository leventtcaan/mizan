import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/ui/Navbar";
import GlobalAssistant from "@/components/GlobalAssistant";
import HtmlLangSync from "@/components/HtmlLangSync";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mizan",
  description: "Harcama davranışını anla.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang here is a server-rendered default; HtmlLangSync updates it to the
    // user's stored choice or detected browser locale after hydration.
    <html lang="tr">
      <body className={`${inter.className} bg-[#11100E] text-white antialiased`}>
        <HtmlLangSync />
        <Navbar />
        {children}
        <GlobalAssistant />
      </body>
    </html>
  );
}

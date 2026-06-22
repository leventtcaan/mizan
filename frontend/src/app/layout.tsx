import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/ui/Navbar";
import GlobalAssistant from "@/components/GlobalAssistant";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mizan",
  description: "Harcama davranışını anla.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className={`${inter.className} bg-[#0F0F0F] text-white antialiased`}>
        <Navbar />
        {children}
        <GlobalAssistant />
      </body>
    </html>
  );
}

"use client";

import { useEffect } from "react";
import { useLanguage } from "@/lib/i18n";

/**
 * Keeps <html lang> in sync with the active UI language. RootLayout is a server
 * component, so it can't read the (client-only) language preference directly —
 * this runs after hydration and updates the attribute, reflecting the stored
 * choice or detected browser locale instead of a hardcoded value.
 */
export default function HtmlLangSync() {
  const { lang } = useLanguage();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}

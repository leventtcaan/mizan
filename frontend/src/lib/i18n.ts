"use client";

import { useEffect, useState } from "react";
import { tr } from "@/locales/tr";
import { en } from "@/locales/en";

export type Lang = "tr" | "en";
type Locale = typeof tr;

const STORAGE_KEY = "mizan_lang";
const CHANGE_EVENT = "mizan-lang-change";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const locales: Record<Lang, any> = { tr, en };


function getCurrentLang(): Lang {
  if (typeof window === "undefined") return "tr";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "en" ? "en" : "tr";
}

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return path;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "string") return current;
  return path;
}

export function t(key: string, lang?: Lang): string {
  const resolvedLang = lang ?? getCurrentLang();
  const locale = locales[resolvedLang] as unknown as Record<string, unknown>;
  return getNestedValue(locale, key);
}

export function setLanguage(lang: Lang): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, lang);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: lang }));
}

export function useLanguage(): { lang: Lang; setLanguage: (lang: Lang) => void; t: (key: string) => string } {
  const [lang, setLangState] = useState<Lang>("tr");

  useEffect(() => {
    setLangState(getCurrentLang());
    const handler = (e: Event) => {
      setLangState((e as CustomEvent<Lang>).detail);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const boundT = (key: string) => t(key, lang);
  const boundSet = (newLang: Lang) => {
    setLangState(newLang);
    setLanguage(newLang);
  };

  return { lang, setLanguage: boundSet, t: boundT };
}

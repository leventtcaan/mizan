"use client";

import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "mizan_theme";
const CHANGE_EVENT = "mizan-theme-change";

/**
 * The stored preference. Defaults to "light" on first visit (no stored value) —
 * light is the product's intended default look; "system" only applies if the user
 * explicitly picks it in the toggle.
 */
export function getThemePref(): ThemePref {
  if (typeof window === "undefined") return "light";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "light";
}

/** Resolve a preference to the concrete theme actually applied. */
export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

/** Write data-theme onto <html>. */
export function applyTheme(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}

export function setThemePref(pref: ThemePref): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, pref);
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pref }));
}

/**
 * The no-FOUC bootstrap, stringified for an inline <script> in <head>.
 * Runs before first paint: reads the stored preference and sets data-theme so
 * there is no flash. First visit (no stored value) defaults to LIGHT; dark only
 * shows when explicitly chosen, or when the user picked "system" on a dark OS.
 */
export const THEME_BOOTSTRAP = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}");var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function useTheme(): { pref: ThemePref; resolved: "light" | "dark"; setTheme: (p: ThemePref) => void } {
  const [pref, setPref] = useState<ThemePref>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const p = getThemePref();
    setPref(p);
    setResolved(resolveTheme(p));
    applyTheme(p);

    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ThemePref>).detail;
      setPref(next);
      setResolved(resolveTheme(next));
    };
    window.addEventListener(CHANGE_EVENT, onChange);

    // Follow the OS in real time while on "system".
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => {
      if (getThemePref() === "system") {
        applyTheme("system");
        setResolved(resolveTheme("system"));
      }
    };
    mq.addEventListener("change", onMq);

    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const setTheme = (p: ThemePref) => {
    setPref(p);
    setResolved(resolveTheme(p));
    setThemePref(p);
  };

  return { pref, resolved, setTheme };
}

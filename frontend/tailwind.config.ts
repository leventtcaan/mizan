import type { Config } from "tailwindcss";

const config: Config = {
  // WHY: content paths tell Tailwind which files to scan for class names.
  // Unused classes are purged — final CSS is tiny (< 10 KB) instead of 3 MB.
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Theme toggles a [data-theme="dark"] attribute on <html>; the CSS-variable
  // tokens in globals.css do the actual color switching, so Tailwind's own
  // dark: variant keys off the same attribute for the rare cases we need it.
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Channel-based tokens (rgb(var() / <alpha-value>)) so opacity
        // modifiers like bg-brand/10 and text-neg/80 keep working.
        canvas: "rgb(var(--c-canvas) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--c-surface-3) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        "line-strong": "rgb(var(--c-line-strong) / <alpha-value>)",
        ink: "rgb(var(--c-text) / <alpha-value>)",
        "ink-soft": "rgb(var(--c-text-secondary) / <alpha-value>)",
        "ink-mute": "rgb(var(--c-text-muted) / <alpha-value>)",
        brand: "rgb(var(--c-brand) / <alpha-value>)",
        "brand-hover": "rgb(var(--c-brand-hover) / <alpha-value>)",
        action: "rgb(var(--c-action) / <alpha-value>)",
        "action-hover": "rgb(var(--c-action-hover) / <alpha-value>)",
        pos: "rgb(var(--c-pos) / <alpha-value>)",
        neg: "rgb(var(--c-neg) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;

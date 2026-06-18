import type { Config } from "tailwindcss";

const config: Config = {
  // WHY: content paths tell Tailwind which files to scan for class names.
  // Unused classes are purged — final CSS is tiny (< 10 KB) instead of 3 MB.
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;

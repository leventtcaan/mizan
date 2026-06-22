"use client";

import { useLanguage } from "@/lib/i18n";

interface CategoryBadgeProps {
  category: string | null;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  market:    { bg: "bg-emerald-950", text: "text-emerald-300", dot: "bg-emerald-400" },
  restoran:  { bg: "bg-orange-950",  text: "text-orange-300",  dot: "bg-orange-400"  },
  ulasim:    { bg: "bg-sky-950",     text: "text-sky-300",     dot: "bg-sky-400"     },
  fatura:    { bg: "bg-violet-950",  text: "text-violet-300",  dot: "bg-violet-400"  },
  saglik:    { bg: "bg-rose-950",    text: "text-rose-300",    dot: "bg-rose-400"    },
  giyim:     { bg: "bg-pink-950",    text: "text-pink-300",    dot: "bg-pink-400"    },
  eglence:   { bg: "bg-yellow-950",  text: "text-yellow-300",  dot: "bg-yellow-400"  },
  nakit_atm: { bg: "bg-zinc-900",    text: "text-zinc-300",    dot: "bg-zinc-400"    },
  transfer:  { bg: "bg-indigo-950",  text: "text-indigo-300",  dot: "bg-indigo-400"  },
  iade:      { bg: "bg-teal-950",    text: "text-teal-300",    dot: "bg-teal-400"    },
  vergi:     { bg: "bg-red-950",     text: "text-red-300",     dot: "bg-red-400"     },
  teknoloji: { bg: "bg-blue-950",    text: "text-blue-300",    dot: "bg-blue-400"    },
  diger:     { bg: "bg-[#2A2A2A]",   text: "text-gray-400",   dot: "bg-gray-500"    },
  egitim:    { bg: "bg-lime-950",    text: "text-lime-300",    dot: "bg-lime-400"    },
};

const FALLBACK = { bg: "bg-[#2A2A2A]", text: "text-gray-500", dot: "bg-gray-600" };

export default function CategoryBadge({ category }: CategoryBadgeProps) {
  const { t } = useLanguage();
  const style = category ? (CATEGORY_STYLES[category] ?? FALLBACK) : FALLBACK;
  const localeKey = `category.${category}`;
  const translated = category ? t(localeKey) : "—";
  const label = translated === localeKey ? (category ?? "—") : translated;

  return (
    <span className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      {label}
    </span>
  );
}

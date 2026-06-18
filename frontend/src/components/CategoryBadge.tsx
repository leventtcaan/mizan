import { CATEGORY_LABELS } from "@/lib/categories";

interface CategoryBadgeProps {
  category: string | null;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  market:    { bg: "bg-emerald-900", text: "text-emerald-300" },
  restoran:  { bg: "bg-orange-900",  text: "text-orange-300"  },
  ulasim:    { bg: "bg-sky-900",     text: "text-sky-300"     },
  fatura:    { bg: "bg-violet-900",  text: "text-violet-300"  },
  saglik:    { bg: "bg-rose-900",    text: "text-rose-300"    },
  giyim:     { bg: "bg-pink-900",    text: "text-pink-300"    },
  eglence:   { bg: "bg-yellow-900",  text: "text-yellow-300"  },
  nakit_atm: { bg: "bg-zinc-800",    text: "text-zinc-300"    },
  transfer:  { bg: "bg-indigo-900",  text: "text-indigo-300"  },
  iade:      { bg: "bg-teal-900",    text: "text-teal-300"    },
  vergi:     { bg: "bg-red-900",     text: "text-red-400"     },
  teknoloji: { bg: "bg-blue-900",    text: "text-blue-300"    },
  diger:     { bg: "bg-gray-800",    text: "text-gray-400"    },
  egitim:    { bg: "bg-lime-900",    text: "text-lime-300"    },
};

const FALLBACK_STYLE = { bg: "bg-gray-800", text: "text-gray-400" };

export default function CategoryBadge({ category }: CategoryBadgeProps) {
  const style = category ? (CATEGORY_STYLES[category] ?? FALLBACK_STYLE) : FALLBACK_STYLE;
  const label = category ? (CATEGORY_LABELS[category] ?? category) : "—";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}
    >
      {label}
    </span>
  );
}

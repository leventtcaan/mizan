/**
 * WHAT: Colored pill badge for a transaction category string.
 * WHY: Category coloring is used in both TransactionTable and future summary charts —
 *      centralising it here means one color change propagates everywhere.
 * BREAKS IF REMOVED: Table shows raw category strings with no visual distinction.
 */

interface CategoryBadgeProps {
  category: string | null;
}

// WHY: Turkish category slugs match the VALID_CATEGORIES set in categorizer.py.
// Colors chosen for maximum contrast on dark backgrounds.
const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  market:    { bg: "bg-emerald-900", text: "text-emerald-300", label: "Market" },
  restoran:  { bg: "bg-orange-900",  text: "text-orange-300",  label: "Restoran" },
  ulasim:    { bg: "bg-sky-900",     text: "text-sky-300",     label: "Ulaşım" },
  fatura:    { bg: "bg-violet-900",  text: "text-violet-300",  label: "Fatura" },
  saglik:    { bg: "bg-rose-900",    text: "text-rose-300",    label: "Sağlık" },
  giyim:     { bg: "bg-pink-900",    text: "text-pink-300",    label: "Giyim" },
  eglence:   { bg: "bg-yellow-900",  text: "text-yellow-300",  label: "Eğlence" },
  nakit_atm: { bg: "bg-zinc-800",    text: "text-zinc-300",    label: "Nakit/ATM" },
  transfer:  { bg: "bg-indigo-900",  text: "text-indigo-300",  label: "Transfer" },
  iade:      { bg: "bg-teal-900",    text: "text-teal-300",    label: "İade" },
  vergi:     { bg: "bg-red-900",     text: "text-red-400",     label: "Vergi" },
  teknoloji: { bg: "bg-blue-900",    text: "text-blue-300",    label: "Teknoloji" },
  diger:     { bg: "bg-gray-800",    text: "text-gray-400",    label: "Diğer" },
};

const FALLBACK = { bg: "bg-gray-800", text: "text-gray-400", label: "—" };

export default function CategoryBadge({ category }: CategoryBadgeProps) {
  const style = category ? (CATEGORY_STYLES[category] ?? FALLBACK) : FALLBACK;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

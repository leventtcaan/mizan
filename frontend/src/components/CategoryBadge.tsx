"use client";

import { useLanguage } from "@/lib/i18n";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "@/lib/categories";

interface CategoryBadgeProps {
  category: string | null;
}

/**
 * A soft, theme-safe category pill: the category's own color at low opacity for the
 * fill, the solid color for text + dot. Works in light and dark (the tint is
 * translucent over whatever surface it sits on) — no hardcoded dark `*-950` boxes.
 */
export default function CategoryBadge({ category }: CategoryBadgeProps) {
  const { t } = useLanguage();
  const localeKey = `category.${category}`;
  const translated = category ? t(localeKey) : "—";
  const label = !category ? "—" : translated === localeKey ? category : translated;

  if (!category) {
    return (
      <span className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-surface-2 text-ink-mute">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-line-strong" />
        {label}
      </span>
    );
  }

  const color = CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: `${color}1F`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

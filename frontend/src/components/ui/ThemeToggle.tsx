"use client";

import { useTheme, type ThemePref } from "@/lib/theme";
import { Sun, Moon, Monitor } from "@/components/ui/Icons";

const OPTIONS: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

/**
 * Light / Dark / System segmented control. Lives in the navbar (visible, not
 * buried in settings) so theme is a first-class, one-tap choice.
 */
export default function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { pref, setTheme } = useTheme();
  const pad = size === "sm" ? "p-1" : "p-1.5";

  return (
    <div className="flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={`${pad} rounded-md transition-colors ${
              active
                ? "bg-surface text-brand shadow-sm"
                : "text-ink-mute hover:text-ink-soft"
            }`}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

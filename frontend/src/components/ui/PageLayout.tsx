interface Props {
  children: React.ReactNode;
  title?: string;
  titleBadge?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl";
}

const MAX_WIDTHS = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
};

export default function PageLayout({ children, title, titleBadge, subtitle, action, maxWidth = "lg" }: Props) {
  return (
    <div className={`${MAX_WIDTHS[maxWidth]} mx-auto px-4 pt-8 pb-16 mt-14`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-8 gap-4">
          {title && (
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold text-ink">{title}</h1>
                {titleBadge}
              </div>
              {subtitle && <p className="text-ink-mute text-sm mt-1">{subtitle}</p>}
            </div>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

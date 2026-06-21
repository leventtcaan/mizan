interface Props {
  children: React.ReactNode;
  title?: string;
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

export default function PageLayout({ children, title, subtitle, action, maxWidth = "lg" }: Props) {
  return (
    <div className={`${MAX_WIDTHS[maxWidth]} mx-auto px-4 pt-8 pb-16 mt-14`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-8 gap-4">
          {title && (
            <div>
              <h1 className="text-2xl font-bold text-white">{title}</h1>
              {subtitle && <p className="text-gray-400 text-sm mt-1">{subtitle}</p>}
            </div>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function Icon({ size = 18, className = "", strokeWidth = 1.75, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function BarChart2({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </Icon>
  );
}

export function CreditCard({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </Icon>
  );
}

export function Layers({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </Icon>
  );
}

export function Upload({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </Icon>
  );
}

export function LogOut({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Icon>
  );
}

export function Brain({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.66z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.66z" />
    </Icon>
  );
}

export function Target({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Icon>
  );
}

export function RefreshCw({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Icon>
  );
}

export function TrendingUp({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </Icon>
  );
}

export function ShieldCheck({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </Icon>
  );
}

export function FileText({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </Icon>
  );
}

export function MessageSquare({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  );
}

export function Menu({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </Icon>
  );
}

export function X({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Icon>
  );
}

export function ChevronDown({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polyline points="6 9 12 15 18 9" />
    </Icon>
  );
}

export function ChevronUp({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polyline points="18 15 12 9 6 15" />
    </Icon>
  );
}

export function Bell({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Icon>
  );
}

export function Mail({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </Icon>
  );
}

export function Plus({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
  );
}

export function Mic({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </Icon>
  );
}

export function Send({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </Icon>
  );
}

export function Zap({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </Icon>
  );
}

export function PieChart({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </Icon>
  );
}

export function ArrowRight({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </Icon>
  );
}

export function TrendingDown({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </Icon>
  );
}

export function DollarSign({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Icon>
  );
}

export function Home({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </Icon>
  );
}

export function Car({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </Icon>
  );
}

export function Briefcase({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Icon>
  );
}

export function Wallet({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <path d="M20 12V22H4a2 2 0 0 1-2-2V6a2 2 0 0 0 2 2h16v4z" />
      <path d="M20 12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2" />
      <circle cx="16" cy="17" r="1" />
    </Icon>
  );
}

export function Scale({ size, className, strokeWidth }: IconProps) {
  return (
    <Icon size={size} className={className} strokeWidth={strokeWidth}>
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M3 6l9 6 9-6" />
      <path d="M6 21H18" />
    </Icon>
  );
}

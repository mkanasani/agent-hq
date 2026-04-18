import GlassCard from "./GlassCard";
import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: "primary" | "accent" | "success" | "purple";
  sub?: string;
};

const ACCENT_MAP = {
  primary: "text-primary",
  accent: "text-accent",
  success: "text-success",
  purple: "text-purple",
};

export default function MetricCard({ label, value, icon: Icon, accent = "primary", sub }: Props) {
  return (
    <GlassCard hover className="relative overflow-hidden">
      {Icon && (
        <Icon
          size={120}
          className="absolute -right-6 -bottom-6 text-white/[0.03]"
          strokeWidth={1}
        />
      )}
      <div className="flex items-center gap-2 text-white/80 text-xs uppercase tracking-widest font-display font-bold">
        {Icon && <Icon size={14} className={ACCENT_MAP[accent]} strokeWidth={2.5} />}
        {label}
      </div>
      <div className="stat-num mt-3">{value}</div>
      {sub && <div className="text-white/60 text-sm mt-2 font-semibold">{sub}</div>}
    </GlassCard>
  );
}

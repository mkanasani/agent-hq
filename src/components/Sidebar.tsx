import { NavLink } from "react-router-dom";
import {
  Building2,
  KanbanSquare,
  Activity as ActivityIcon,
  Users,
  Inbox,
  Webhook,
  Code2,
  Mic,
  LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Office", icon: Building2, end: true },
  { to: "/tasks", label: "Tasks", icon: KanbanSquare },
  { to: "/activity", label: "Activity", icon: ActivityIcon },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/voice", label: "Voice", icon: Mic },
  { to: "/forms", label: "Forms", icon: Inbox },
  { to: "/pages", label: "Pages", icon: LayoutTemplate },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/integrations", label: "Integrations", icon: Code2 },
];

export default function Sidebar() {
  return (
    <aside className="w-[280px] shrink-0 border-r border-white/[0.06] px-5 py-8 flex flex-col gap-10">
      <Logo />
      <nav className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn("nav-pill", isActive && "active")}
          >
            <Icon size={18} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <div className="glass px-4 py-3">
          <p className="text-xs uppercase tracking-widest text-white/70 mb-1.5 font-display font-bold">Status</p>
          <div className="flex items-center gap-2">
            <span className="pulse-dot dot-green" />
            <span className="text-sm text-white font-semibold">All systems operational</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/40 to-purple/40 border border-white/10 flex items-center justify-center shadow-glow">
          <span className="font-display font-bold text-xl">HQ</span>
        </div>
        <div className="absolute inset-0 rounded-2xl shadow-glow animate-pulse" />
      </div>
      <div className="text-center">
        <div className="font-display font-black tracking-[0.25em] text-lg">AGENT HQ</div>
        <div className="text-[10px] tracking-[0.4em] text-white/70 uppercase font-semibold">Mission Control</div>
      </div>
    </div>
  );
}

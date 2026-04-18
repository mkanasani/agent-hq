import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import { call } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import type { Activity as Entry } from "@/lib/types";

const CATEGORY_STYLE: Record<string, string> = {
  task: "text-primary border-primary/40",
  research: "text-purple border-purple/40",
  email: "text-accent border-accent/40",
  content: "text-amber border-amber/40",
  decision: "text-success border-success/40",
  error: "text-danger border-danger/40",
  system: "text-white/70 border-white/20",
};

const SEED: Entry[] = [
  { id: "1", agent_id: null, category: "email", summary: "Nova sent 24 outreach emails to qualified ICP leads", details: null, created_at: new Date(Date.now() - 90_000).toISOString() },
  { id: "2", agent_id: null, category: "research", summary: "Sage completed deep research on Acme Corp, Stripe, and Linear", details: null, created_at: new Date(Date.now() - 240_000).toISOString() },
  { id: "3", agent_id: null, category: "decision", summary: "Atlas rescheduled 3 conflicting meetings and notified all attendees", details: null, created_at: new Date(Date.now() - 480_000).toISOString() },
  { id: "4", agent_id: null, category: "content", summary: "Echo drafted 5 content pieces from blog URL", details: null, created_at: new Date(Date.now() - 900_000).toISOString() },
  { id: "5", agent_id: null, category: "task", summary: "Task 'Qualify 12 inbound leads' moved to Done", details: null, created_at: new Date(Date.now() - 1_800_000).toISOString() },
  { id: "6", agent_id: null, category: "system", summary: "Daily heartbeat cycle complete — all agents responsive", details: null, created_at: new Date(Date.now() - 3_600_000).toISOString() },
];

export default function Activity() {
  const [log, setLog] = useState<Entry[]>([]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      const list = await call<Entry[]>("activity.list", { limit: 200 });
      setLog(list);
    } catch {
      // keep seed
    }
  }

  const display = log.length > 0 ? log : SEED;

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every action your agents take, categorized and timestamped. This is your paper trail."
      />

      <GlassCard className="p-0">
        <div className="divide-y divide-white/[0.06]">
          {display.map((e) => (
            <div key={e.id} className="flex items-start gap-4 px-6 py-4">
              <span
                className={cn(
                  "px-2.5 py-0.5 rounded-full border text-[10px] uppercase tracking-widest font-display shrink-0 mt-0.5",
                  CATEGORY_STYLE[e.category] ?? CATEGORY_STYLE.system,
                )}
              >
                {e.category}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/90">{e.summary}</p>
              </div>
              <span className="text-xs text-white/40 font-mono shrink-0">{timeAgo(e.created_at)}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </>
  );
}

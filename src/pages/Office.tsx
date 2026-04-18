import { useEffect, useMemo, useState } from "react";
import { Users, KanbanSquare, Activity as ActivityIcon, Zap } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import MetricCard from "@/components/MetricCard";
import AgentSprite from "@/components/AgentSprite";
import PageHeader from "@/components/PageHeader";
import { call } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { Agent, Activity, Task } from "@/lib/types";

// ── Demo seed so empty deploy looks alive ────────────────────────────
const SEED_AGENTS: Agent[] = [
  { id: "a1", name: "Atlas", sign_in_name: "atlas-a1b2", api_key: null, role: "Executive Assistant", emoji: "🧭", color: "#00BFFF", status: "online", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a2", name: "Nova", sign_in_name: "nova-c3d4", api_key: null, role: "Outreach SDR", emoji: "🚀", color: "#FF6B35", status: "online", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a3", name: "Lexa", sign_in_name: "lexa-e5f6", api_key: null, role: "Voice Agent", emoji: "🎙️", color: "#A855F7", status: "idle", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a4", name: "Sage", sign_in_name: "sage-g7h8", api_key: null, role: "Research Analyst", emoji: "🔍", color: "#00E676", status: "online", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a5", name: "Echo", sign_in_name: "echo-i9j0", api_key: null, role: "Content Writer", emoji: "✍️", color: "#F59E0B", status: "idle", last_heartbeat: null, created_at: "" },
];

const SEED_ACTIVITY: Activity[] = [
  { id: "1", agent_id: "a2", category: "email", summary: "Nova sent 24 outreach emails", details: null, created_at: new Date(Date.now() - 90_000).toISOString() },
  { id: "2", agent_id: "a4", category: "research", summary: "Sage researched 8 prospect companies", details: null, created_at: new Date(Date.now() - 240_000).toISOString() },
  { id: "3", agent_id: "a1", category: "decision", summary: "Atlas rescheduled 3 conflicting meetings", details: null, created_at: new Date(Date.now() - 480_000).toISOString() },
  { id: "4", agent_id: "a5", category: "content", summary: "Echo drafted 5 content pieces from blog URL", details: null, created_at: new Date(Date.now() - 900_000).toISOString() },
];

// Scattered positions around the scene — percentages
const POSITIONS = [
  { x: 20, y: 35 },
  { x: 52, y: 28 },
  { x: 80, y: 40 },
  { x: 32, y: 68 },
  { x: 70, y: 72 },
  { x: 14, y: 78 },
];

export default function Office() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      const [a, l, t] = await Promise.all([
        call<Agent[]>("agent.list").catch(() => [] as Agent[]),
        call<Activity[]>("activity.list", { limit: 20 }).catch(() => [] as Activity[]),
        call<Task[]>("task.list").catch(() => [] as Task[]),
      ]);
      setAgents(a);
      setActivity(l);
      setTasks(t);
    } catch {
      // noop — API key not set yet; seed data remains visible
    }
  }

  const displayAgents = agents.length > 0 ? agents : SEED_AGENTS;
  const displayActivity = activity.length > 0 ? activity : SEED_ACTIVITY;
  const taskInProgress = tasks.filter((t) => t.status === "doing").length;

  const stats = useMemo(
    () => [
      { label: "Active Agents", value: displayAgents.filter((a) => a.status === "online").length, icon: Users, accent: "success" as const },
      { label: "Tasks In Progress", value: tasks.length ? taskInProgress : 3, icon: KanbanSquare, accent: "primary" as const },
      { label: "Activity Today", value: displayActivity.length, icon: ActivityIcon, accent: "accent" as const },
      { label: "Uptime", value: "99.9%", icon: Zap, accent: "purple" as const },
    ],
    [displayAgents, displayActivity, tasks, taskInProgress],
  );

  return (
    <>
      <PageHeader
        title="The Office"
        subtitle="Your AI employees, live on duty. This is mission control."
      />

      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <MetricCard key={s.label} {...s} />
        ))}
      </div>

      {/* Scene */}
      <GlassCard className="relative p-0 overflow-hidden h-[520px]">
        <SceneBackdrop />
        {displayAgents.slice(0, POSITIONS.length).map((a, i) => (
          <AgentSprite key={a.id} agent={a} x={POSITIONS[i].x} y={POSITIONS[i].y} delay={i * 0.15} />
        ))}
        <div className="absolute top-4 left-4 glass px-3 py-1.5 font-mono text-xs text-white font-bold tracking-wider">
          <span className="pulse-dot dot-green inline-block mr-2 align-middle" /> LIVE
        </div>
        <div className="absolute top-4 right-4 glass px-3 py-1.5 font-mono text-xs text-white/90 font-semibold">
          {displayAgents.length} agents · {displayActivity.length} events
        </div>
      </GlassCard>

      {/* Activity ticker */}
      <div className="mt-6">
        <h2 className="font-display text-lg tracking-widest text-white font-bold mb-3 uppercase">Live Activity</h2>
        <GlassCard className="p-0">
          <div className="divide-y divide-white/[0.06]">
            {displayActivity.slice(0, 8).map((a) => {
              const agent = displayAgents.find((x) => x.id === a.agent_id);
              return (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="text-xl">{agent?.emoji ?? "⚡"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{a.summary}</div>
                    <div className="text-[10px] text-white/65 uppercase tracking-widest font-bold mt-0.5">{a.category}</div>
                  </div>
                  <span className="text-xs text-white/70 font-mono shrink-0 font-semibold">{timeAgo(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </>
  );
}

function SceneBackdrop() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Floor perspective */}
      <div
        className="absolute inset-x-0 bottom-0 h-[55%]"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(0,191,255,0.04) 40%, rgba(168,85,247,0.06) 100%)",
        }}
      />
      {/* Grid floor */}
      <div
        className="absolute inset-x-0 bottom-0 h-[55%] opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,191,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(0,191,255,0.18) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(180deg, transparent 0%, black 30%, black 100%)",
          transform: "perspective(800px) rotateX(55deg)",
          transformOrigin: "bottom",
        }}
      />
      {/* Horizon glow */}
      <div
        className="absolute inset-x-0 top-[40%] h-px"
        style={{ boxShadow: "0 0 40px 8px rgba(0,191,255,0.35)" }}
      />
      {/* Corner glows */}
      <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-purple/20 blur-3xl" />
    </div>
  );
}

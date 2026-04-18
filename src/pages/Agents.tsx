import { useEffect, useState } from "react";
import { Plus, Copy, Eye, EyeOff, AtSign } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import StatusRing, { StatusLabel } from "@/components/StatusRing";
import { call } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { Agent } from "@/lib/types";

const SEED: Agent[] = [
  { id: "a1", name: "Atlas", sign_in_name: "atlas-a1b2", api_key: "akey_demo_atlas_executive_assistant_x1", role: "Executive Assistant", emoji: "🧭", color: "#00BFFF", status: "online", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a2", name: "Nova", sign_in_name: "nova-c3d4", api_key: "akey_demo_nova_outreach_sdr_x2", role: "Outreach SDR", emoji: "🚀", color: "#FF6B35", status: "online", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a3", name: "Lexa", sign_in_name: "lexa-e5f6", api_key: "akey_demo_lexa_voice_agent_x3", role: "Voice Agent", emoji: "🎙️", color: "#A855F7", status: "idle", last_heartbeat: new Date(Date.now() - 300_000).toISOString(), created_at: "" },
  { id: "a4", name: "Sage", sign_in_name: "sage-g7h8", api_key: "akey_demo_sage_research_analyst_x4", role: "Research Analyst", emoji: "🔍", color: "#00E676", status: "online", last_heartbeat: new Date().toISOString(), created_at: "" },
  { id: "a5", name: "Echo", sign_in_name: "echo-i9j0", api_key: "akey_demo_echo_content_writer_x5", role: "Content Writer", emoji: "✍️", color: "#F59E0B", status: "idle", last_heartbeat: null, created_at: "" },
];

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      setAgents(await call<Agent[]>("agent.list"));
    } catch {
      // keep seed
    }
  }

  const display = agents.length > 0 ? agents : SEED;

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Each one is an AI employee with a name, a sign-in, and a heartbeat."
        right={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide">
            <Plus size={16} /> Register Agent
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-5">
        {display.map((a) => {
          const show = revealed[a.id];
          const masked = a.api_key ? (show ? a.api_key : a.api_key.replace(/.(?=.{4})/g, "•")) : "— no key —";
          return (
            <GlassCard key={a.id} hover className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <StatusRing status={a.status} size={64}>
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
                    style={{
                      background: `radial-gradient(circle at 30% 30%, ${a.color}55, ${a.color}15 60%, transparent)`,
                      border: `1px solid ${a.color}66`,
                    }}
                  >
                    <span>{a.emoji}</span>
                  </div>
                </StatusRing>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg tracking-wide text-white font-bold">{a.name}</div>
                  <div className="text-xs text-white/75 uppercase tracking-widest font-bold">{a.role}</div>
                  <div className="flex items-center gap-1 mt-1 font-mono text-xs text-primary font-semibold">
                    <AtSign size={11} strokeWidth={2.5} />
                    {a.sign_in_name}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/60 font-display font-bold mb-1.5">
                  Sign-in Key
                </div>
                <div className="flex items-center gap-2 font-mono text-xs bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2">
                  <span className="flex-1 truncate text-primary font-semibold">{masked}</span>
                  <button
                    onClick={() => setRevealed((r) => ({ ...r, [a.id]: !r[a.id] }))}
                    className="text-white/70 hover:text-white shrink-0"
                  >
                    {show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={() => a.api_key && navigator.clipboard.writeText(a.api_key)}
                    className="text-white/70 hover:text-white shrink-0"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-white/70 font-mono border-t border-white/[0.06] pt-3 font-semibold">
                <StatusLabel status={a.status} />
                <span>last seen {timeAgo(a.last_heartbeat)}</span>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </>
  );
}

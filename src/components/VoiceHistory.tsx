import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Mic, Trash2, User } from "lucide-react";
import GlassCard from "./GlassCard";
import { call } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { VoiceSessionRecord } from "@/lib/types";

export default function VoiceHistory() {
  const [sessions, setSessions] = useState<VoiceSessionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const list = await call<VoiceSessionRecord[]>("voice.session.list", { limit: 20 });
      setSessions(list);
    } catch {
      // noop
    } finally {
      setLoaded(true);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this conversation transcript?")) return;
    try {
      await call("voice.session.delete", { id });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // noop
    }
  }

  if (!loaded) {
    return null;
  }

  if (sessions.length === 0) {
    return (
      <GlassCard className="text-center py-10 mt-8">
        <p className="text-sm text-white/60 font-medium">
          No past conversations yet. Your transcripts will appear here after your first voice session.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="mt-10">
      <h3 className="font-display text-lg tracking-widest uppercase text-white font-bold mb-4 flex items-center gap-2">
        <Clock size={16} className="text-primary" strokeWidth={2.5} /> Past Conversations
      </h3>
      <div className="flex flex-col gap-3">
        {sessions.map((s) => {
          const firstUser = s.transcripts.find((t) => t.role === "user")?.text ?? "—";
          const mins = Math.floor(s.duration_seconds / 60);
          const secs = s.duration_seconds % 60;
          const duration = mins ? `${mins}m ${secs}s` : `${secs}s`;
          const isOpen = !!open[s.id];
          return (
            <GlassCard key={s.id} hover className="p-0 overflow-hidden">
              <button
                className="w-full flex items-center gap-4 px-5 py-4 text-left"
                onClick={() => setOpen((p) => ({ ...p, [s.id]: !p[s.id] }))}
              >
                <div className="text-white/60 shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">"{firstUser}"</p>
                  <div className="flex items-center gap-4 text-[10px] text-white/60 uppercase tracking-widest font-bold mt-1.5 font-mono">
                    <span>{timeAgo(s.started_at)}</span>
                    <span>·</span>
                    <span>{duration}</span>
                    <span>·</span>
                    <span>{s.transcripts.length} turns</span>
                    {s.tools.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-accent">{s.tools.length} tool call{s.tools.length === 1 ? "" : "s"}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(s.id);
                  }}
                  className="text-white/40 hover:text-danger shrink-0 p-2"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </button>

              {isOpen && (
                <div className="border-t border-white/[0.06] bg-black/20">
                  <div className="divide-y divide-white/[0.04]">
                    {s.transcripts.map((t, i) => (
                      <div
                        key={i}
                        className={`px-5 py-3 ${t.role === "agent" ? "bg-primary/[0.03]" : ""}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {t.role === "user" ? (
                            <User size={11} className="text-white/60" strokeWidth={2.5} />
                          ) : (
                            <Mic size={11} className="text-primary" strokeWidth={2.5} />
                          )}
                          <span
                            className={`text-[10px] uppercase tracking-widest font-display font-bold ${
                              t.role === "agent" ? "text-primary" : "text-white/60"
                            }`}
                          >
                            {t.role === "agent" ? "Agent" : "You"}
                          </span>
                        </div>
                        <p className="text-sm text-white/95 font-medium">{t.text}</p>
                      </div>
                    ))}
                  </div>
                  {s.tools.length > 0 && (
                    <div className="px-5 py-3 border-t border-white/[0.06]">
                      <div className="text-[10px] uppercase tracking-widest text-white/60 font-display font-bold mb-2">
                        Tools Called
                      </div>
                      <div className="flex flex-col gap-1">
                        {s.tools.map((t, i) => (
                          <div key={i} className="text-xs font-mono text-white/80">
                            <span className="text-accent font-bold">{t.name}</span>
                            <span className="text-white/50"> {JSON.stringify(t.params)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, Zap, User } from "lucide-react";
import GlassCard from "./GlassCard";
import { VoiceSession, type VoiceEvent } from "@/lib/geminiLive";
import { call } from "@/lib/api";

type Transcript = { role: "user" | "agent"; text: string; final: boolean; id: number };
type ToolEvent = { name: string; params: Record<string, unknown>; result?: unknown; error?: string; id: number };

type Props = {
  apiKey: string;
  invitationContext?: string;
  invitationPreamble?: string;
  invitationId?: string | null;
  onSessionEnd: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  connecting: "CONNECTING",
  listening: "LISTENING",
  speaking: "SPEAKING",
  thinking: "THINKING",
  idle: "IDLE",
};

const STATUS_COLOR: Record<string, string> = {
  connecting: "text-white/60 bg-white/10",
  listening: "text-success bg-success/15",
  speaking: "text-primary bg-primary/15",
  thinking: "text-amber bg-amber/15",
  idle: "text-white/40 bg-white/5",
};

export default function VoiceSessionUI({
  apiKey,
  invitationContext,
  invitationPreamble,
  invitationId,
  onSessionEnd,
}: Props) {
  const [status, setStatus] = useState<keyof typeof STATUS_LABEL>("idle");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const idRef = useRef(0);
  const startedAtRef = useRef<string>(new Date().toISOString());
  const transcriptsRef = useRef<Transcript[]>([]);
  const toolsRef = useRef<ToolEvent[]>([]);
  const savedRef = useRef(false);

  useEffect(() => {
    const s = new VoiceSession({
      apiKey,
      invitationContext,
      invitationPreamble,
    });
    sessionRef.current = s;
    startedAtRef.current = new Date().toISOString();

    const off = s.on((e: VoiceEvent) => {
      if (e.type === "status") setStatus(e.value);
      if (e.type === "error") setError(e.message);
      if (e.type === "transcript") {
        setTranscripts((prev) => {
          const last = prev[prev.length - 1];
          let next;
          if (last && last.role === e.role && !last.final) {
            next = [...prev];
            next[next.length - 1] = { ...last, text: e.text, final: e.final };
          } else {
            next = [...prev, { role: e.role, text: e.text, final: e.final, id: idRef.current++ }];
          }
          transcriptsRef.current = next;
          return next;
        });
      }
      if (e.type === "tool") {
        setTools((prev) => {
          const existing = prev.find(
            (t) => t.name === e.name && JSON.stringify(t.params) === JSON.stringify(e.params),
          );
          let next = prev;
          if (existing && (e.result !== undefined || e.error !== undefined)) {
            next = prev.map((t) =>
              t === existing ? { ...t, result: e.result, error: e.error } : t,
            );
          } else if (!existing) {
            next = [...prev, { ...e, id: idRef.current++ }];
          }
          toolsRef.current = next;
          return next;
        });
      }
    });

    void s.start();

    return () => {
      off();
      void s.stop().then(() => saveTranscript());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function endCall() {
    await sessionRef.current?.stop();
    await saveTranscript();
    onSessionEnd();
  }

  async function saveTranscript() {
    if (savedRef.current) return;
    const finalTranscripts = transcriptsRef.current.filter((t) => t.text.trim().length > 0);
    if (finalTranscripts.length === 0) return;
    savedRef.current = true;
    try {
      await call("voice.session.save", {
        started_at: startedAtRef.current,
        ended_at: new Date().toISOString(),
        transcripts: finalTranscripts.map((t) => ({ role: t.role, text: t.text, final: t.final })),
        tools: toolsRef.current.map((t) => ({
          name: t.name,
          params: t.params,
          result: t.result,
          error: t.error,
        })),
        invitation_id: invitationId ?? null,
      });
      if (invitationId) {
        await call("voice.invitation.accept", { id: invitationId }).catch(() => undefined);
      }
    } catch (err) {
      console.error("[voice] failed to save transcript:", err);
    }
  }

  return (
    <div className="grid grid-cols-5 gap-6">
      {/* Main session panel */}
      <div className="col-span-3 flex flex-col gap-4">
        <GlassCard className="relative overflow-hidden p-0 h-[380px]">
          <SessionBackdrop status={status} />
          <div className="relative z-10 flex flex-col items-center justify-center h-full">
            <VoiceOrb status={status} />
            <div
              className={`mt-6 px-4 py-1.5 rounded-full font-display text-xs tracking-widest font-bold uppercase ${STATUS_COLOR[status]}`}
            >
              {STATUS_LABEL[status]}
            </div>
            <p className="text-sm text-white/70 font-medium mt-4 max-w-xs text-center">
              {status === "connecting" && "Connecting to Gemini Live..."}
              {status === "listening" && "Go ahead — I'm listening."}
              {status === "speaking" && "Speaking..."}
              {status === "thinking" && "Thinking..."}
              {status === "idle" && "Session ended."}
            </p>
          </div>
          <button
            onClick={() => void endCall()}
            className="absolute top-4 right-4 z-20 flex items-center gap-2 px-4 py-2 rounded-xl bg-danger/20 border border-danger/40 text-danger hover:bg-danger/30 transition font-bold tracking-wide text-xs uppercase"
          >
            <PhoneOff size={14} strokeWidth={2.5} /> End
          </button>
        </GlassCard>

        {error && (
          <GlassCard className="border-danger/40 bg-danger/[0.06]">
            <p className="text-sm text-danger font-semibold">{error}</p>
          </GlassCard>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="font-display text-xs tracking-widest uppercase text-white/75 font-bold flex items-center gap-2">
            <Zap size={13} className="text-accent" strokeWidth={2.5} /> Actions Your Agent Took
          </h3>
          <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto">
            {tools.length === 0 ? (
              <GlassCard className="text-center py-5 text-sm text-white/50 font-medium">
                No tools called yet. Try saying "add a task to draft the Acme proposal."
              </GlassCard>
            ) : (
              tools.map((t) => (
                <GlassCard key={t.id} className="p-3 flex items-center gap-3">
                  <code className="font-mono text-xs text-accent font-bold shrink-0">{t.name}</code>
                  <code className="font-mono text-xs text-white/70 flex-1 truncate">
                    {JSON.stringify(t.params)}
                  </code>
                  {t.error ? (
                    <span className="text-xs text-danger font-bold shrink-0">ERROR</span>
                  ) : t.result !== undefined ? (
                    <span className="text-xs text-success font-bold shrink-0">OK</span>
                  ) : (
                    <span className="text-xs text-white/40 font-bold shrink-0">PENDING</span>
                  )}
                </GlassCard>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Transcript panel */}
      <div className="col-span-2 flex flex-col gap-2">
        <h3 className="font-display text-xs tracking-widest uppercase text-white/75 font-bold">
          Transcript
        </h3>
        <GlassCard className="p-0 h-[620px] overflow-y-auto">
          {transcripts.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center px-6">
              <p className="text-sm text-white/50 font-medium max-w-xs">
                Transcript appears here as you and your agent speak.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {transcripts.map((t) => (
                <div
                  key={t.id}
                  className={`px-5 py-3 border-b border-white/[0.04] ${
                    t.role === "agent" ? "bg-primary/[0.04]" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {t.role === "user" ? (
                      <User size={12} className="text-white/60" strokeWidth={2.5} />
                    ) : (
                      <Mic size={12} className="text-primary" strokeWidth={2.5} />
                    )}
                    <span
                      className={`text-[10px] uppercase tracking-widest font-display font-bold ${
                        t.role === "agent" ? "text-primary" : "text-white/60"
                      }`}
                    >
                      {t.role === "agent" ? "Agent" : "You"}
                    </span>
                  </div>
                  <p className="text-sm text-white/95 font-medium leading-snug">{t.text}</p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function VoiceOrb({ status }: { status: string }) {
  const color = status === "speaking" ? "#00BFFF" : status === "listening" ? "#00E676" : "#A855F7";
  const active = status === "listening" || status === "speaking";

  return (
    <div className="relative w-44 h-44 flex items-center justify-center">
      <div
        className="absolute inset-0 rounded-full blur-2xl transition-opacity"
        style={{ background: color, opacity: active ? 0.45 : 0.15 }}
      />
      <div
        className="absolute inset-2 rounded-full blur-lg transition-opacity"
        style={{ background: color, opacity: active ? 0.6 : 0.2 }}
      />
      {active && (
        <>
          <div
            className="absolute inset-0 rounded-full border-2 animate-ping"
            style={{ borderColor: color, opacity: 0.4, animationDuration: "1.6s" }}
          />
          <div
            className="absolute inset-6 rounded-full border-2 animate-ping"
            style={{ borderColor: color, opacity: 0.3, animationDuration: "1.6s", animationDelay: "0.4s" }}
          />
        </>
      )}
      <div
        className="relative w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${color}55, ${color}15 60%, transparent)`,
          border: `1px solid ${color}88`,
        }}
      >
        <Mic size={36} strokeWidth={2} style={{ color }} />
      </div>
    </div>
  );
}

function SessionBackdrop({ status }: { status: string }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            status === "speaking"
              ? "linear-gradient(180deg, transparent 0%, rgba(0,191,255,0.08) 100%)"
              : "linear-gradient(180deg, transparent 0%, rgba(168,85,247,0.06) 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,191,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(0,191,255,0.18) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(180deg, transparent 0%, black 30%, black 100%)",
          transform: "perspective(600px) rotateX(55deg)",
          transformOrigin: "bottom",
        }}
      />
    </div>
  );
}

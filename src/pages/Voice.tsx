import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Mic, KeyRound, Settings, Sparkles, PhoneCall } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import VoiceOnboarding from "@/components/VoiceOnboarding";
import VoiceSessionUI from "@/components/VoiceSessionUI";
import VoiceHistory from "@/components/VoiceHistory";
import { call } from "@/lib/api";
import type { VoiceInvitation } from "@/lib/types";

type Phase = "loading" | "onboarding" | "idle" | "session";

const SUGGESTED_PROMPTS = [
  "Create a task to follow up with Acme Corp tomorrow as high priority.",
  "Log that I just sent the proposal to the client — category email.",
  "What tasks are in progress right now?",
  "Show me all my active agents.",
  "Remind me to review yesterday's meeting notes — make it a medium priority task.",
  "Log a decision: I'm pausing the Q2 content push until after the launch.",
];

export default function Voice() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<VoiceInvitation | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    void checkConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkConfig() {
    try {
      const res = await call<{ configured: boolean }>("voice.config.check");
      setPhase(res.configured ? "idle" : "onboarding");
    } catch {
      setPhase("onboarding");
    }
  }

  async function startSession(invitationOverride?: VoiceInvitation | null) {
    try {
      const res = await call<{ gemini_key: string }>("voice.config.get");
      setApiKey(res.gemini_key);
      if (invitationOverride) setInvitation(invitationOverride);
      setPhase("session");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to fetch Gemini key");
    }
  }

  // Auto-start if arriving via an invitation link
  useEffect(() => {
    const invId = searchParams.get("invitation");
    if (!invId || phase !== "idle") return;
    void (async () => {
      try {
        const inv = await call<VoiceInvitation>("voice.invitation.get", { id: invId });
        await startSession(inv);
        searchParams.delete("invitation");
        setSearchParams(searchParams, { replace: true });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Invitation not found");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, searchParams]);

  async function resetConfig() {
    if (!confirm("Replace the stored Gemini key?")) return;
    try {
      await call("voice.config.clear");
      setPhase("onboarding");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to clear");
    }
  }

  function handleSessionEnd() {
    setInvitation(null);
    setPhase("idle");
  }

  if (phase === "loading") {
    return (
      <>
        <PageHeader title="Voice" subtitle="Talking to your agent, live, in your browser." />
        <GlassCard className="text-center py-16">
          <p className="text-white/70 font-medium">Loading...</p>
        </GlassCard>
      </>
    );
  }

  if (phase === "onboarding") {
    return (
      <>
        <PageHeader title="Voice" subtitle="Talking to your agent, live, in your browser." />
        <VoiceOnboarding onSaved={() => setPhase("idle")} />
      </>
    );
  }

  if (phase === "session" && apiKey) {
    const invContext = invitation
      ? `The agent "${invitation.agent_name}" initiated this conversation with the following context:\n\n${invitation.context || invitation.reason}`
      : undefined;
    const invPreamble = invitation
      ? `[SYSTEM] You were paged by the agent ${invitation.agent_name}. Open the conversation now.`
      : undefined;
    return (
      <>
        <PageHeader
          title={invitation ? `${invitation.agent_name} is calling` : "Voice"}
          subtitle={
            invitation
              ? `"${invitation.reason}"`
              : "Live session. Speak naturally — your agent can act while you talk."
          }
        />
        <VoiceSessionUI
          apiKey={apiKey}
          invitationContext={invContext}
          invitationPreamble={invPreamble}
          invitationId={invitation?.id ?? null}
          onSessionEnd={handleSessionEnd}
        />
      </>
    );
  }

  // Idle — ready to start a call
  return (
    <>
      <PageHeader
        title="Voice"
        subtitle="Your agent is configured. Start a conversation and watch it take real actions as you talk."
        right={
          <button
            onClick={() => void resetConfig()}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-white/70 hover:text-white hover:bg-white/5 text-xs uppercase tracking-widest font-bold transition"
            title="Replace Gemini key"
          >
            <Settings size={14} /> Replace Key
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-5 mb-8">
        <Tile icon={KeyRound} label="Gemini Key" value="Configured" accent="success" />
        <Tile icon={Mic} label="Model" value="Gemini 3.1 Flash Live" accent="primary" />
        <Tile icon={PhoneCall} label="Mode" value="Browser (WebRTC)" accent="purple" />
      </div>

      <GlassCard className="text-center py-16 relative overflow-hidden mb-8">
        <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-purple/10 blur-3xl" />

        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/30 to-purple/30 border border-primary/40 flex items-center justify-center shadow-glow mx-auto mb-5">
            <Mic size={42} className="text-primary" strokeWidth={2} />
          </div>
          <h2 className="font-display text-2xl text-white font-bold tracking-wide mb-2">Ready when you are.</h2>
          <p className="text-sm text-white/75 font-medium max-w-md mx-auto mb-6">
            Your agent can create tasks, log activity, and query the dashboard while you talk.
            The transcript + actions appear live as you go.
          </p>
          <button
            onClick={() => void startSession()}
            className="inline-flex items-center gap-2 px-7 py-4 rounded-xl bg-primary hover:bg-primary/90 text-black font-display font-black tracking-widest text-sm uppercase shadow-glow transition"
          >
            <Mic size={18} strokeWidth={3} /> Start Conversation
          </button>
          <p className="text-xs text-white/50 font-medium mt-4">
            Your browser will ask for microphone access.
          </p>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-accent" strokeWidth={2.3} />
          <h3 className="font-display text-sm tracking-widest uppercase text-white font-bold">
            Real things you can say
          </h3>
        </div>
        <p className="text-sm text-white/75 font-medium mb-4">
          Start a conversation and try one of these out loud. You'll see tasks appear, activity log
          update, and your agent confirm — all live.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <div
              key={p}
              className="glass p-3 text-sm text-white/90 font-medium border-white/[0.06] hover:border-primary/40 transition"
            >
              "{p}"
            </div>
          ))}
        </div>
      </GlassCard>

      <VoiceHistory />
    </>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Mic;
  label: string;
  value: string;
  accent: "primary" | "success" | "purple";
}) {
  const cls =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
        ? "text-success"
        : "text-purple";
  return (
    <GlassCard className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center ${cls}`}>
        <Icon size={20} strokeWidth={2.3} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-white/65 font-display font-bold">{label}</div>
        <div className="text-sm text-white font-bold mt-0.5">{value}</div>
      </div>
    </GlassCard>
  );
}

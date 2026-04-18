import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PhoneCall, X } from "lucide-react";
import { call } from "@/lib/api";
import type { VoiceInvitation } from "@/lib/types";

export default function VoiceInvitationBanner() {
  const [invitations, setInvitations] = useState<VoiceInvitation[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      const list = await call<VoiceInvitation[]>("voice.invitation.list");
      setInvitations(list);
    } catch {
      // noop
    }
  }

  async function dismiss(id: string) {
    try {
      await call("voice.invitation.dismiss", { id });
      setInvitations((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // noop
    }
  }

  function answer(id: string) {
    navigate(`/voice?invitation=${id}`);
  }

  // Don't show on voice page itself — invitations surface via the page directly.
  if (location.pathname.startsWith("/voice")) return null;
  if (invitations.length === 0) return null;

  const top = invitations[0];

  return (
    <div className="fixed top-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] animate-fade-in">
      <div className="glass p-4 border-2 border-primary/50 shadow-glow bg-gradient-to-br from-primary/[0.08] to-purple/[0.08]">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/50 flex items-center justify-center shrink-0 animate-pulse">
            <PhoneCall size={18} className="text-primary" strokeWidth={2.3} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display text-xs tracking-widest uppercase text-primary font-bold">
              Incoming from {top.agent_name}
            </div>
            <p className="text-sm text-white font-medium mt-1 leading-snug">{top.reason}</p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => answer(top.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-black font-display font-black tracking-widest text-[10px] uppercase shadow-glow"
              >
                <PhoneCall size={12} strokeWidth={3} /> Answer
              </button>
              <button
                onClick={() => void dismiss(top.id)}
                className="px-3 py-1.5 rounded-lg text-white/70 hover:text-white text-[10px] uppercase tracking-widest font-bold"
              >
                Dismiss
              </button>
              {invitations.length > 1 && (
                <span className="text-[10px] text-white/50 uppercase tracking-widest font-bold font-mono ml-auto">
                  +{invitations.length - 1} more
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => void dismiss(top.id)}
            className="text-white/40 hover:text-white shrink-0 -mr-1 -mt-1"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

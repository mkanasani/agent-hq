import { useEffect, useState } from "react";
import { Plus, Copy, Sparkles, Calendar, CreditCard, GitPullRequest, Mail } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import NewWebhookModal from "@/components/NewWebhookModal";
import { call } from "@/lib/api";
import { copyToClipboard } from "@/lib/utils";
import type { Webhook } from "@/lib/types";

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      setWebhooks(await call<Webhook[]>("webhook.list"));
    } catch {
      // noop
    } finally {
      setLoaded(true);
    }
  }

  const showEmpty = loaded && webhooks.length === 0;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="Catch-all inbound URLs. Paste one into any external service, and every event flows into your activity log — where an agent can react in real time."
        right={
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide"
          >
            <Plus size={16} /> New Webhook
          </button>
        }
      />

      <GlassCard className="mb-6 bg-gradient-to-br from-accent/[0.08] to-purple/[0.08] border-accent/30">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/25 border border-accent/50 flex items-center justify-center shrink-0 shadow-glow-accent animate-pulse">
            <Sparkles size={22} className="text-accent" strokeWidth={2.3} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display text-xs tracking-[0.3em] uppercase text-accent font-bold mb-1">
              Coming Tomorrow · AI SDR
            </div>
            <div className="font-display text-lg text-white font-bold mb-1">
              Your webhook setup today becomes a lead-printing machine tomorrow.
            </div>
            <p className="text-sm text-white/80 font-medium">
              Tomorrow we wire webhooks + forms + pages + agents into a full AI SDR system. Booking comes in
              → agent preps the briefing. Contact form fills → agent researches, drafts outreach, schedules
              the follow-up. Set the endpoints up now; tomorrow we make them print pipeline.
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-4 gap-3 mb-8">
        <UseCase
          icon={Calendar}
          label="Cal.com bookings"
          copy="Every booking auto-creates a pre-meeting briefing task."
        />
        <UseCase
          icon={CreditCard}
          label="Stripe payments"
          copy="New paying customer → agent sends a personalized thank-you + onboarding."
        />
        <UseCase
          icon={GitPullRequest}
          label="GitHub issues"
          copy="Issue opened → agent triages severity and drafts the first response."
        />
        <UseCase
          icon={Mail}
          label="Email reply tracking"
          copy="Replies come in via webhook → agent updates the lead record automatically."
        />
      </div>

      {showEmpty ? (
        <GlassCard className="text-center py-16">
          <div className="font-display text-xl text-white font-bold mb-2">No webhooks yet</div>
          <p className="text-sm text-white/70 font-medium mb-6 max-w-md mx-auto">
            Create a webhook URL and paste it into any service. Every event shows up in your activity log.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary hover:bg-primary/90 text-black font-display font-black tracking-widest text-sm uppercase shadow-glow transition"
          >
            <Plus size={16} strokeWidth={3} /> Create First Webhook
          </button>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-4">
          {webhooks.map((w) => {
            const url = `${baseUrl}/api/webhook/${w.id}`;
            return (
              <GlassCard key={w.id} hover>
                <div className="flex items-center gap-6">
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-lg tracking-wide text-white font-bold">{w.name}</div>
                    <p className="text-sm text-white/75 mt-1 font-medium">{w.description}</p>
                    <div className="mt-3 flex items-center gap-2 font-mono text-xs text-white/90 bg-black/40 border border-white/[0.06] rounded-lg px-3 py-2 max-w-xl">
                      <span className="truncate flex-1 font-semibold">{url}</span>
                      <button
                        className="text-primary hover:text-primary/80 shrink-0"
                        onClick={() => void copyToClipboard(url)}
                        title="Copy URL"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="stat-num text-4xl">{w.event_count}</div>
                    <div className="text-[10px] text-white/70 uppercase tracking-widest font-bold">events</div>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      <NewWebhookModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(w) => setWebhooks((prev) => [w, ...prev])}
      />
    </>
  );
}

function UseCase({
  icon: Icon,
  label,
  copy,
}: {
  icon: typeof Calendar;
  label: string;
  copy: string;
}) {
  return (
    <GlassCard hover className="p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-primary shrink-0" strokeWidth={2.3} />
        <span className="font-display text-xs uppercase tracking-widest text-white font-bold">{label}</span>
      </div>
      <p className="text-xs text-white/70 font-medium leading-snug">{copy}</p>
    </GlassCard>
  );
}

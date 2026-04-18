import { useEffect, useState } from "react";
import { Plus, Copy } from "lucide-react";
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
        subtitle="Catch-all inbound URLs. Give one to any service — Cal, Stripe, GitHub, Zapier — and let an agent react."
        right={
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide"
          >
            <Plus size={16} /> New Webhook
          </button>
        }
      />

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

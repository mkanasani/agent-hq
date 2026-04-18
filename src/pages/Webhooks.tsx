import { useEffect, useState } from "react";
import { Plus, Copy } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import { call } from "@/lib/api";
import type { Webhook } from "@/lib/types";

const SEED: Webhook[] = [
  { id: "wh_cal_123", name: "Cal.com Bookings", description: "Every booking triggers Atlas to prep a briefing", event_count: 42, created_at: "" },
  { id: "wh_stripe_456", name: "Stripe Payments", description: "New paid invoices go into activity + thank-you email", event_count: 17, created_at: "" },
  { id: "wh_github_789", name: "GitHub Issues", description: "New issues auto-triaged by Sage", event_count: 128, created_at: "" },
];

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      setWebhooks(await call<Webhook[]>("webhook.list"));
    } catch {
      // keep seed
    }
  }

  const display = webhooks.length > 0 ? webhooks : SEED;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="Catch-all inbound URLs. Give one to any service — Cal, Stripe, GitHub, Zapier — and let an agent react."
        right={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition">
            <Plus size={16} /> New Webhook
          </button>
        }
      />

      <div className="flex flex-col gap-4">
        {display.map((w) => {
          const url = `${baseUrl}/api/webhook/${w.id}`;
          return (
            <GlassCard key={w.id} hover>
              <div className="flex items-center gap-6">
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg tracking-wide">{w.name}</div>
                  <p className="text-sm text-white/50 mt-1">{w.description}</p>
                  <div className="mt-3 flex items-center gap-2 font-mono text-xs text-white/70 bg-black/30 border border-white/[0.06] rounded-lg px-3 py-2 max-w-xl">
                    <span className="truncate flex-1">{url}</span>
                    <button
                      className="text-primary hover:text-primary/80 shrink-0"
                      onClick={() => navigator.clipboard.writeText(url)}
                      title="Copy URL"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="stat-num text-4xl">{w.event_count}</div>
                  <div className="text-[10px] text-white/40 uppercase tracking-widest">events</div>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </>
  );
}

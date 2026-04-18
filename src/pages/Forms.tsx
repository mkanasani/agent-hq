import { useEffect, useState } from "react";
import { Plus, Copy, ExternalLink } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import { call } from "@/lib/api";
import type { FormConfig } from "@/lib/types";

const SEED: FormConfig[] = [
  {
    slug: "lead-intake",
    title: "New Lead Intake",
    description: "Collect inbound leads and assign them to Nova for outreach.",
    fields: [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "email", label: "Work Email", type: "email", required: true },
      { name: "company", label: "Company", type: "text", required: true },
      { name: "message", label: "What brings you here?", type: "textarea", required: false },
    ],
    created_at: new Date().toISOString(),
  },
  {
    slug: "support-ticket",
    title: "Support Request",
    description: "Customer issues, routed to Atlas for triage.",
    fields: [
      { name: "email", label: "Your Email", type: "email", required: true },
      { name: "issue", label: "Describe the issue", type: "textarea", required: true },
    ],
    created_at: new Date().toISOString(),
  },
];

export default function Forms() {
  const [forms, setForms] = useState<FormConfig[]>([]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setForms(await call<FormConfig[]>("form.list"));
    } catch {
      // keep seed
    }
  }

  const display = forms.length > 0 ? forms : SEED;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Public URLs that agents watch. Every submission lands in the activity log and becomes work."
        right={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition">
            <Plus size={16} /> New Form
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-5">
        {display.map((f) => {
          const publicUrl = `${baseUrl}/form/${f.slug}`;
          return (
            <GlassCard key={f.slug} hover className="flex flex-col gap-4">
              <div>
                <div className="font-display text-xl tracking-wide">{f.title}</div>
                <p className="text-sm text-white/50 mt-1">{f.description}</p>
              </div>

              <div className="flex items-center gap-2 font-mono text-xs text-white/70 bg-black/30 border border-white/[0.06] rounded-lg px-3 py-2 overflow-hidden">
                <span className="truncate flex-1">{publicUrl}</span>
                <button
                  className="text-primary hover:text-primary/80 shrink-0"
                  onClick={() => navigator.clipboard.writeText(publicUrl)}
                  title="Copy URL"
                >
                  <Copy size={14} />
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:text-primary/80 shrink-0"
                  title="Open form"
                >
                  <ExternalLink size={14} />
                </a>
              </div>

              <div className="flex items-center gap-4 text-xs text-white/40 border-t border-white/[0.06] pt-3 font-mono uppercase tracking-widest">
                <span>{f.fields.length} fields</span>
                <span>/ {f.slug}</span>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </>
  );
}

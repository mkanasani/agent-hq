import { useEffect, useState } from "react";
import { Plus, Copy, ExternalLink } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import NewFormModal from "@/components/NewFormModal";
import { call } from "@/lib/api";
import { copyToClipboard } from "@/lib/utils";
import type { FormConfig } from "@/lib/types";

export default function Forms() {
  const [forms, setForms] = useState<FormConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setForms(await call<FormConfig[]>("form.list"));
    } catch {
      // noop
    } finally {
      setLoaded(true);
    }
  }

  const showEmpty = loaded && forms.length === 0;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Public URLs that agents watch. Every submission lands in the activity log and becomes work."
        right={
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide"
          >
            <Plus size={16} /> New Form
          </button>
        }
      />

      {showEmpty && (
        <GlassCard className="text-center py-16">
          <div className="font-display text-xl text-white font-bold mb-2">No forms yet</div>
          <p className="text-sm text-white/70 font-medium mb-6 max-w-md mx-auto">
            Create a public form and share the URL. Every submission shows up in your activity log and your agent can act on it.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary hover:bg-primary/90 text-black font-display font-black tracking-widest text-sm uppercase shadow-glow transition"
          >
            <Plus size={16} strokeWidth={3} /> Create First Form
          </button>
        </GlassCard>
      )}

      {!showEmpty && forms.length > 0 && (
        <div className="grid grid-cols-2 gap-5">
          {forms.map((f) => {
            const publicUrl = `${baseUrl}/form/${f.slug}`;
            return (
              <GlassCard key={f.slug} hover className="flex flex-col gap-4">
                <div>
                  <div className="font-display text-xl tracking-wide text-white font-bold">{f.title}</div>
                  <p className="text-sm text-white/75 mt-1 font-medium">{f.description}</p>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs text-white/90 bg-black/40 border border-white/[0.06] rounded-lg px-3 py-2 overflow-hidden">
                  <span className="truncate flex-1 font-semibold">{publicUrl}</span>
                  <button
                    className="text-primary hover:text-primary/80 shrink-0"
                    onClick={() => void copyToClipboard(publicUrl)}
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

                <div className="flex items-center gap-4 text-xs text-white/65 border-t border-white/[0.06] pt-3 font-mono uppercase tracking-widest font-bold">
                  <span>{f.fields.length} fields</span>
                  <span>/ {f.slug}</span>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      <NewFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(f) => setForms((prev) => [f, ...prev])}
      />
    </>
  );
}

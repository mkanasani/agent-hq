import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Copy, ExternalLink, ArrowRight, LayoutTemplate, Sparkles } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import NewFormModal from "@/components/NewFormModal";
import SkillViewerModal from "@/components/SkillViewerModal";
import { call } from "@/lib/api";
import { copyToClipboard } from "@/lib/utils";
import type { FormConfig, Page } from "@/lib/types";
import formsSkillMd from "../../skills/mission-control-forms.md?raw";

function pagesLinkedToForm(formSlug: string, allPages: Page[]): Page[] {
  const marker = new RegExp(
    `\\{\\{form:${formSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`,
    "i",
  );
  return allPages.filter(
    (p) => p.linked_form_slug === formSlug || marker.test(p.html_body || ""),
  );
}

export default function Forms() {
  const [forms, setForms] = useState<FormConfig[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [formsRes, pagesRes] = await Promise.allSettled([
      call<FormConfig[]>("form.list"),
      call<Page[]>("page.list"),
    ]);
    if (formsRes.status === "fulfilled") setForms(formsRes.value);
    if (pagesRes.status === "fulfilled") setPages(pagesRes.value);
    setLoaded(true);
  }

  const showEmpty = loaded && forms.length === 0;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const linkedPagesByForm = useMemo(() => {
    const map: Record<string, Page[]> = {};
    for (const f of forms) map[f.slug] = pagesLinkedToForm(f.slug, pages);
    return map;
  }, [forms, pages]);

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Public URLs your agents watch. Link a form to a landing page and every submission flows back here — cancel the Webflow/Squarespace subscription, let your agents publish and own the loop."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSkillOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-accent/25 to-purple/25 border border-accent/50 text-white hover:border-accent/80 transition font-bold tracking-wide shadow-glow-accent"
            >
              <Sparkles size={16} strokeWidth={2.5} /> Teach Your Agent
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide"
            >
              <Plus size={16} /> New Form
            </button>
          </div>
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
            const linkedPages = linkedPagesByForm[f.slug] ?? [];
            return (
              <Link
                key={f.slug}
                to={`/forms/${f.slug}`}
                className="glass glass-hover p-6 flex flex-col gap-4 cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-xl tracking-wide text-white font-bold">{f.title}</div>
                    <p className="text-sm text-white/75 mt-1 font-medium">{f.description}</p>
                  </div>
                  <ArrowRight
                    size={18}
                    className="text-white/30 group-hover:text-primary group-hover:translate-x-1 transition shrink-0 mt-1"
                  />
                </div>

                {linkedPages.length > 0 && (
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-accent font-display font-bold shrink-0 mt-1">
                      <LayoutTemplate size={11} strokeWidth={2.5} />
                      Embedded on
                    </div>
                    {linkedPages.map((p) => (
                      <a
                        key={p.slug}
                        href={`${baseUrl}/p/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/15 border border-accent/40 text-accent text-xs font-mono font-semibold hover:bg-accent/25 transition"
                        title={p.title}
                      >
                        /p/{p.slug}
                        <ExternalLink size={10} strokeWidth={2.5} />
                      </a>
                    ))}
                  </div>
                )}

                <div
                  className="flex items-center gap-2 font-mono text-xs text-white/90 bg-black/40 border border-white/[0.06] rounded-lg px-3 py-2 overflow-hidden"
                  onClick={(e) => e.preventDefault()}
                >
                  <span className="truncate flex-1 font-semibold">{publicUrl}</span>
                  <button
                    className="text-primary hover:text-primary/80 shrink-0"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void copyToClipboard(publicUrl);
                    }}
                    title="Copy URL"
                  >
                    <Copy size={14} />
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:text-primary/80 shrink-0"
                    title="Open form in new tab"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>

                <div className="flex items-center justify-between text-xs text-white/65 border-t border-white/[0.06] pt-3 font-mono uppercase tracking-widest font-bold">
                  <div className="flex items-center gap-4">
                    <span>{f.fields.length} fields</span>
                    <span>/ {f.slug}</span>
                  </div>
                  <span className="text-primary group-hover:text-primary/80">View submissions →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <NewFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(f) => setForms((prev) => [f, ...prev])}
      />

      <SkillViewerModal
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
        title="Forms Skill — public intake in 30 seconds"
        description="Paste this into your OpenClaw, Claude Code, Hermes, or any agent runtime. Teaches your agent to create typed forms, read submissions, and embed them into landing pages with the {{form:slug}} marker."
        skillMarkdown={formsSkillMd}
      />
    </>
  );
}

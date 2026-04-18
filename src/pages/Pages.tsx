import { useEffect, useState } from "react";
import { Plus, Copy, ExternalLink, Trash2, Link as LinkIcon, Sparkles } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import NewPageModal from "@/components/NewPageModal";
import SkillViewerModal from "@/components/SkillViewerModal";
import { call } from "@/lib/api";
import { copyToClipboard, timeAgo } from "@/lib/utils";
import type { Page } from "@/lib/types";
import landingPageSkillMd from "../../skills/mission-control-landing-page.md?raw";

export default function Pages() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setPages(await call<Page[]>("page.list"));
    } catch {
      // noop
    } finally {
      setLoaded(true);
    }
  }

  async function remove(slug: string, title: string) {
    if (!confirm(`Delete landing page "${title}"? This cannot be undone.`)) return;
    try {
      await call("page.delete", { slug });
      setPages((prev) => prev.filter((p) => p.slug !== slug));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const showEmpty = loaded && pages.length === 0;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <PageHeader
        title="Pages"
        subtitle="Landing pages your agents publish. Linked to forms. Live URLs. No Webflow required."
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
              <Plus size={16} /> New Page
            </button>
          </div>
        }
      />

      <GlassCard className="mb-6 bg-gradient-to-br from-accent/[0.06] to-purple/[0.06] border-accent/25">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/20 border border-accent/50 flex items-center justify-center shrink-0 shadow-glow-accent">
            <Sparkles size={22} className="text-accent" strokeWidth={2.3} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display text-sm tracking-widest uppercase text-accent font-bold mb-1">
              Front-end dev skill · $1K value · free
            </div>
            <p className="text-sm text-white/85 font-medium">
              Glassmorphic design, glow effects, hover animations, form embeds — all wrapped in one
              copy-paste skill. Teach any agent to ship beautiful landing pages from a natural-language brief.
            </p>
          </div>
          <button
            onClick={() => setSkillOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-black font-display font-black tracking-widest text-xs uppercase shadow-glow-accent shrink-0"
          >
            <Sparkles size={14} strokeWidth={3} /> View Skill
          </button>
        </div>
      </GlassCard>

      {showEmpty && (
        <GlassCard className="text-center py-16">
          <div className="font-display text-xl text-white font-bold mb-2">No pages yet</div>
          <p className="text-sm text-white/70 font-medium mb-6 max-w-xl mx-auto">
            Ask your agent to create a landing page — or hit "New Page" to write one by hand.
            Both routes hit the same endpoint; both end up at{" "}
            <code className="text-primary">/p/&lt;slug&gt;</code> on your domain.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary hover:bg-primary/90 text-black font-display font-black tracking-widest text-sm uppercase shadow-glow transition"
          >
            <Plus size={16} strokeWidth={3} /> Create First Page
          </button>
        </GlassCard>
      )}

      {!showEmpty && pages.length > 0 && (
        <div className="grid grid-cols-2 gap-5">
          {pages.map((p) => {
            const publicUrl = `${baseUrl}/p/${p.slug}`;
            return (
              <GlassCard key={p.slug} hover className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-xl tracking-wide text-white font-bold">{p.title}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/65 font-mono uppercase tracking-widest font-bold">
                      <span>/p/{p.slug}</span>
                      {p.linked_form_slug && (
                        <span className="flex items-center gap-1 text-primary">
                          <LinkIcon size={11} strokeWidth={2.5} /> {p.linked_form_slug}
                        </span>
                      )}
                    </div>
                  </div>
                  {p.accent && (
                    <div
                      className="w-5 h-5 rounded-md border border-white/10 shrink-0"
                      style={{ background: p.accent }}
                      title={p.accent}
                    />
                  )}
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
                    title="Open page"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>

                <div className="flex items-center justify-between text-xs text-white/70 font-mono border-t border-white/[0.06] pt-3 font-semibold">
                  <span>updated {timeAgo(p.updated_at)}</span>
                  <button
                    onClick={() => void remove(p.slug, p.title)}
                    className="text-white/40 hover:text-danger transition"
                    title="Delete page"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      <NewPageModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(p) => setPages((prev) => [p, ...prev])}
      />

      <SkillViewerModal
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
        title="Front-end Dev Skill for Landing Pages"
        description="Paste this into your OpenClaw, Claude Code, Hermes, or any agent runtime. It teaches your agent to chain form.create → page.create, apply glassmorphic styling, glow, hover animations, and ship a live URL in under 30 seconds."
        skillMarkdown={landingPageSkillMd}
      />
    </>
  );
}

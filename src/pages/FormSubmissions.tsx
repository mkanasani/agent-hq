import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Copy, ExternalLink, Inbox, RefreshCw } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import { call } from "@/lib/api";
import { copyToClipboard, timeAgo } from "@/lib/utils";
import type { FormConfig, FormSubmission } from "@/lib/types";

export default function FormSubmissions() {
  const { slug } = useParams();
  const [form, setForm] = useState<FormConfig | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [slug]);

  async function refresh() {
    if (!slug) return;
    try {
      const [forms, subs] = await Promise.all([
        call<FormConfig[]>("form.list"),
        call<FormSubmission[]>("form.submissions", { slug }),
      ]);
      const found = forms.find((f) => f.slug === slug);
      setForm(found ?? null);
      setSubmissions(subs);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setLoaded(true);
    }
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = slug ? `${baseUrl}/form/${slug}` : "";

  // Sort newest first
  const sorted = useMemo(
    () => [...submissions].sort((a, b) => (a.received_at < b.received_at ? 1 : -1)),
    [submissions],
  );

  if (!slug) return null;

  if (loaded && !form) {
    return (
      <>
        <BackLink />
        <GlassCard className="text-center py-16">
          <div className="font-display text-xl text-white font-bold mb-2">Form not found</div>
          <p className="text-sm text-white/70 font-medium">
            The form <code className="font-mono text-accent">{slug}</code> doesn't exist in your dashboard.
          </p>
        </GlassCard>
      </>
    );
  }

  return (
    <>
      <BackLink />

      <PageHeader
        title={form?.title ?? slug}
        subtitle={form?.description || "Submissions land here the moment someone hits your form."}
        right={
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide"
          >
            <ExternalLink size={15} /> Open Form
          </a>
        }
      />

      {/* Public URL bar */}
      <GlassCard className="mb-6 flex items-center gap-4 p-4">
        <div className="text-[10px] uppercase tracking-widest text-white/70 font-display font-bold shrink-0">
          Public URL
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-white/95 bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 flex-1 min-w-0">
          <span className="truncate flex-1 font-semibold">{publicUrl}</span>
          <button
            onClick={() => void copyToClipboard(publicUrl)}
            className="text-primary hover:text-primary/80 shrink-0"
          >
            <Copy size={14} />
          </button>
        </div>
        <div className="shrink-0 flex flex-col items-end">
          <div className="stat-num text-3xl">{submissions.length}</div>
          <div className="text-[10px] text-white/70 uppercase tracking-widest font-bold">
            submission{submissions.length === 1 ? "" : "s"}
          </div>
        </div>
      </GlassCard>

      {/* Submissions table */}
      {error && (
        <GlassCard className="mb-4 border-danger/40 bg-danger/[0.06]">
          <p className="text-sm text-danger font-semibold">{error}</p>
        </GlassCard>
      )}

      {loaded && submissions.length === 0 ? (
        <GlassCard className="text-center py-16">
          <Inbox size={48} className="text-white/30 mx-auto mb-4" strokeWidth={1.5} />
          <div className="font-display text-xl text-white font-bold mb-2">No submissions yet</div>
          <p className="text-sm text-white/70 font-medium max-w-md mx-auto mb-5">
            Share the URL above. Every submission shows up here in real time and drops
            into the agent activity log.
          </p>
          <div className="flex items-center justify-center gap-1.5 text-xs text-white/50 font-mono">
            <RefreshCw size={11} className="animate-spin" /> Auto-refreshing every 5s
          </div>
        </GlassCard>
      ) : form ? (
        <SubmissionsTable form={form} submissions={sorted} />
      ) : null}
    </>
  );
}

function BackLink() {
  return (
    <Link
      to="/forms"
      className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-primary mb-6 font-display font-bold uppercase tracking-widest transition"
    >
      <ArrowLeft size={14} strokeWidth={2.5} /> All Forms
    </Link>
  );
}

function SubmissionsTable({
  form,
  submissions,
}: {
  form: FormConfig;
  submissions: FormSubmission[];
}) {
  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="text-left px-5 py-3 font-display text-[10px] uppercase tracking-widest text-white/75 font-bold">
                Received
              </th>
              {form.fields.map((f) => (
                <th
                  key={f.name}
                  className="text-left px-5 py-3 font-display text-[10px] uppercase tracking-widest text-white/75 font-bold"
                >
                  {f.label}
                </th>
              ))}
              <th className="text-left px-5 py-3 font-display text-[10px] uppercase tracking-widest text-white/75 font-bold">
                ID
              </th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s, i) => (
              <tr
                key={s.id}
                className={`border-b border-white/[0.04] hover:bg-primary/[0.04] transition ${
                  i === 0 ? "bg-primary/[0.03]" : ""
                }`}
              >
                <td className="px-5 py-3 font-mono text-xs text-white/80 font-semibold whitespace-nowrap">
                  {timeAgo(s.received_at)}
                </td>
                {form.fields.map((f) => (
                  <td
                    key={f.name}
                    className="px-5 py-3 text-white/95 font-medium max-w-xs truncate"
                    title={String(s.data?.[f.name] ?? "")}
                  >
                    {s.data?.[f.name] ? (
                      <span>{String(s.data[f.name])}</span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                ))}
                <td className="px-5 py-3 font-mono text-[10px] text-white/40">{s.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

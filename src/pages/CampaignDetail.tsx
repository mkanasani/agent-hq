import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Beaker,
  Check,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  MousePointerClick,
  Play,
  Send,
  Sparkles,
  Target,
  Trash2,
  Users,
  AlertCircle,
  FlaskConical,
  CheckCircle2,
  ExternalLink,
  Star,
  Phone,
  Globe,
  X,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import Modal, { FormField, PrimaryButton, TextInput, TextArea } from "@/components/Modal";
import { call } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

type Campaign = {
  id: string;
  name: string;
  query: string;
  description?: string;
  structured_query: { location: string; searchTerms: string[]; maxResults: number } | null;
  status: string;
  total_leads_found: number;
  leads_imported: number;
  emails_generated: number;
  emails_sent: number;
  emails_delivered: number;
  emails_bounced: number;
  emails_clicked: number;
  emails_replied: number;
  error_message?: string;
  agentmail_inbox_id?: string;
  apify_run_id?: string | null;
  apify_status?: string | null;
  created_at: string;
  updated_at: string;
};

type Lead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  reviews_count: number | null;
  maps_url: string | null;
  notes?: string | null;
  raw?: Record<string, unknown>;
  status: string;
  is_test: boolean;
  created_at: string;
};

type EmailRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  to_email: string;
  to_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  status: string;
  click_count?: number;
  created_at: string;
  updated_at: string;
};

type Reply = {
  id: string;
  from: string | null;
  subject: string | null;
  text: string | null;
  received_at: string;
  handled: boolean;
};

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<"run" | "generate" | "send" | null>(null);
  const [leadDetail, setLeadDetail] = useState<Lead | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailRow | null>(null);
  const [generateProgress, setGenerateProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number; found: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    void refresh();
    // Light polling so counters tick live when webhooks arrive.
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When a scrape is running on Apify's side, poll the sync action every
  // 4s so we import leads as soon as Apify finishes. Separate from the
  // general refresh interval so we can drive a tighter loop only when
  // we're actively waiting on Apify.
  useEffect(() => {
    if (!id) return;
    if (campaign?.status !== "searching") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await call<{ status: string; apify_status: string | null; changed: boolean }>(
          "outreach.campaign.sync",
          { id },
        );
        if (!cancelled && result.changed) {
          // Terminal state — refresh immediately to pull in leads/status.
          await refresh();
        }
      } catch {
        // Quiet — the regular refresh will surface persistent errors.
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, campaign?.status]);

  async function refresh() {
    if (!id) return;
    try {
      const [c, ls, es, rs] = await Promise.all([
        call<Campaign>("outreach.campaign.get", { id }),
        call<Lead[]>("outreach.leads.list", { campaign_id: id }),
        call<EmailRow[]>("outreach.emails.list", { campaign_id: id }),
        call<Reply[]>("outreach.replies.list", { campaign_id: id, limit: 20 }),
      ]);
      setCampaign(c);
      setLeads(ls);
      setEmails(es);
      setReplies(rs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }

  async function runScrape() {
    if (!id) return;
    setBusyAction("run");
    setErr(null);
    try {
      // This call returns quickly now — it only *starts* the Apify run.
      // The sync poller effect will import leads once the run finishes.
      await call("outreach.campaign.run", { id });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scrape failed to start");
    } finally {
      setBusyAction(null);
    }
  }

  async function sendAll() {
    if (!id) return;
    const drafted = emails.filter((e) => e.status === "drafted").length;
    if (drafted === 0) {
      alert("No drafted emails to send. Generate drafts first.");
      return;
    }
    if (!confirm(`Send ${drafted} emails via AgentMail? This will hit real recipients' inboxes.`)) return;
    setBusyAction("send");
    setErr(null);
    try {
      await call("outreach.emails.send", { campaign_id: id });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeLead(leadId: string) {
    if (!id) return;
    try {
      await call("outreach.leads.delete", { campaign_id: id, lead_id: leadId });
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // Loops through every lead that has a website but no email, scrapes
  // each site for a contact email, updates the lead record. Runs client-
  // side so the progress bar reflects real per-lead latency.
  async function enrichEmails() {
    if (!id) return;
    const targets = leads.filter((l) => !l.email && l.website);
    if (targets.length === 0) return;
    setEnrichProgress({ done: 0, total: targets.length, found: 0 });
    setErr(null);
    let done = 0;
    let found = 0;
    for (const lead of targets) {
      try {
        const result = await call<{ enriched?: boolean }>("outreach.leads.enrich_one", {
          campaign_id: id,
          lead_id: lead.id,
        });
        if (result.enriched) found++;
      } catch {
        // Per-lead failures shouldn't halt the loop — sites block, time out, etc.
      }
      done++;
      setEnrichProgress({ done, total: targets.length, found });
      if (done % 3 === 0 || done === targets.length) await refresh();
    }
    // Leave progress showing for a beat so the user sees the final count,
    // then clear it.
    setTimeout(() => setEnrichProgress(null), 3000);
  }

  // Derive counters from the emails array — race-free unlike the cached
  // counters on the campaign record (which can lose increments when
  // AgentMail fires sent + delivered webhooks in the same millisecond).
  // Delivered/clicked/replied are cumulative — once an email is "clicked"
  // it was also "delivered", etc.
  const counters = useMemo(() => {
    const drafts = emails.filter((e) => e.status === "drafted").length;
    const postSend = emails.filter((e) => e.status !== "drafted");
    const delivered = emails.filter((e) =>
      ["delivered", "clicked", "replied"].includes(e.status),
    ).length;
    const clicked = emails.filter(
      (e) => e.status === "clicked" || e.status === "replied" || (e.click_count ?? 0) > 0,
    ).length;
    const replied = emails.filter((e) => e.status === "replied").length;
    const bounced = emails.filter((e) => e.status === "bounced" || e.status === "complained" || e.status === "failed").length;
    return {
      leads: leads.length,
      leadsWithEmail: leads.filter((l) => l.email).length,
      drafts,
      sent: postSend.length,
      delivered,
      bounced,
      clicked,
      replied,
    };
  }, [emails, leads]);

  if (!campaign) {
    return (
      <div className="flex items-center gap-3 text-white/60">
        <Loader2 size={16} className="animate-spin" /> Loading campaign…
      </div>
    );
  }

  const structured = campaign.structured_query;

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`"${campaign.query}"`}
        right={
          <Link
            to="/outreach"
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 font-semibold transition"
          >
            <ArrowLeft size={14} /> All campaigns
          </Link>
        }
      />

      {err && (
        <GlassCard className="mb-5 border-red-500/40 bg-red-500/10">
          <div className="flex items-center gap-3 text-red-200">
            <AlertCircle size={18} />
            <span className="text-sm font-medium">{err}</span>
          </div>
        </GlassCard>
      )}

      {campaign.error_message && campaign.status === "failed" && (
        <GlassCard className="mb-5 border-red-500/40 bg-red-500/10">
          <div className="flex items-start gap-3 text-red-200">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold mb-1">Last action failed</p>
              <p className="text-xs text-red-300/80">{campaign.error_message}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Scraping banner — Apify run in progress, UI polls every 4s */}
      {campaign.status === "searching" && (
        <GlassCard className="mb-5 bg-gradient-to-br from-primary/[0.08] to-purple/[0.08] border-primary/40">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
              <Loader2 size={18} className="text-primary animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white mb-0.5">Apify scraping Google Maps…</p>
              <p className="text-xs text-white/65">
                Typically 30 seconds to 2 minutes. Leads will appear here automatically when the run completes.
                {campaign.apify_status && (
                  <span className="font-mono text-primary ml-1">· {campaign.apify_status}</span>
                )}
              </p>
            </div>
            <a
              href={campaign.apify_run_id ? `https://console.apify.com/actors/runs/${campaign.apify_run_id}` : "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs text-primary hover:text-white font-mono"
            >
              View on Apify ↗
            </a>
          </div>
        </GlassCard>
      )}

      {/* Strategy summary */}
      <GlassCard className="mb-5 bg-gradient-to-br from-primary/[0.05] to-purple/[0.05]">
        <div className="flex items-start gap-5">
          <div className="w-12 h-12 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
            <Target size={20} className="text-primary" />
          </div>
          <div className="flex-1 space-y-2">
            {structured && (
              <>
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-primary" />
                  <span className="text-sm font-medium text-white">{structured.location}</span>
                  <span className="text-xs text-white/45">·</span>
                  <span className="text-xs text-white/55 font-mono">up to {structured.maxResults} leads</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {structured.searchTerms.map((t, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/65 text-[11px] font-mono"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
            <p className="text-xs text-white/50 pt-1">
              Status: <span className="text-white/80 font-semibold uppercase tracking-wider">{campaign.status}</span>
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Action bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <ActionButton
          disabled={busyAction !== null || !structured || campaign.status === "searching"}
          onClick={runScrape}
          busy={busyAction === "run" || campaign.status === "searching"}
          label={
            campaign.status === "searching"
              ? "Scraping…"
              : counters && counters.leads > 0
              ? "Re-run scrape"
              : "Run Apify scrape"
          }
          sublabel={
            campaign.status === "searching"
              ? `Apify run ${campaign.apify_status?.toLowerCase() ?? "starting"} — results auto-import`
              : counters && counters.leads > 0
              ? `${counters.leads} leads imported`
              : "Fetch real businesses from Google Maps"
          }
          icon={<Play size={16} />}
          tint="primary"
        />
        <ActionButton
          disabled={busyAction !== null || leads.filter((l) => l.email).length === 0}
          onClick={() => setGenerateModalOpen(true)}
          busy={busyAction === "generate"}
          label="Generate emails"
          sublabel={counters && counters.drafts > 0 ? `${counters.drafts} drafts ready` : "Gemini writes a personalised first touch per lead"}
          icon={<Sparkles size={16} />}
          tint="purple"
        />
        <ActionButton
          disabled={busyAction !== null || (counters?.drafts ?? 0) === 0}
          onClick={sendAll}
          busy={busyAction === "send"}
          label="Send campaign"
          sublabel={counters && counters.sent > 0 ? `${counters.sent} sent · AgentMail` : "Fires all drafts from AgentMail inbox"}
          icon={<Send size={16} />}
          tint="accent"
        />
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6">
        <MiniStat label="Leads" value={counters?.leads ?? 0} icon={<Users size={14} />} tint="primary" />
        <MiniStat label="Drafts" value={counters?.drafts ?? 0} icon={<Sparkles size={14} />} tint="purple" />
        <MiniStat label="Sent" value={counters?.sent ?? 0} icon={<Send size={14} />} tint="primary" />
        <MiniStat label="Delivered" value={counters?.delivered ?? 0} icon={<CheckCircle2 size={14} />} tint="green" />
        <MiniStat label="Clicks" value={counters?.clicked ?? 0} icon={<MousePointerClick size={14} />} tint="accent" />
        <MiniStat label="Replies" value={counters?.replied ?? 0} icon={<MessageSquare size={14} />} tint="green" />
      </div>

      {/* Recent replies — the stage-wow strip */}
      {replies.length > 0 && (
        <GlassCard className="mb-6 bg-gradient-to-br from-green-500/[0.06] to-transparent border-green-500/30">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare size={16} className="text-green-400" />
            <h3 className="font-display text-sm tracking-widest uppercase text-green-300 font-bold">Recent replies</h3>
            <span className="text-xs font-mono text-white/50">({replies.length})</span>
          </div>
          <div className="space-y-2">
            {replies.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-lg bg-black/30 border border-white/10 p-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center shrink-0">
                  <MessageSquare size={13} className="text-green-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">{r.from ?? "Unknown"}</span>
                    <span className="text-xs text-white/40 font-mono">{timeAgo(r.received_at)}</span>
                  </div>
                  <p className="text-xs text-white/65 mb-1 truncate">{r.subject ?? "(no subject)"}</p>
                  <p className="text-xs text-white/55 line-clamp-2">{r.text ?? ""}</p>
                </div>
                <Link
                  to="/inbox"
                  className="shrink-0 px-2.5 py-1 rounded-md bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-[10px] font-bold tracking-wider uppercase transition"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Leads table */}
      <GlassCard className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-primary" />
            <h3 className="font-display text-sm tracking-widest uppercase text-white/75 font-bold">Leads</h3>
            <span className="text-xs font-mono text-white/50">({leads.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const withoutEmail = leads.filter((l) => !l.email && l.website).length;
              const enriching = enrichProgress !== null && enrichProgress.done < enrichProgress.total;
              if (withoutEmail === 0 && !enriching) return null;
              return (
                <button
                  onClick={enrichEmails}
                  disabled={enriching || withoutEmail === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-xs font-bold tracking-wide transition disabled:opacity-50"
                >
                  {enriching ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
                  {enriching ? `Finding emails ${enrichProgress!.done}/${enrichProgress!.total}` : `Find emails (${withoutEmail})`}
                </button>
              );
            })()}
            <button
              onClick={() => setTestModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent text-xs font-bold tracking-wide transition"
            >
              <FlaskConical size={13} /> Add test lead
            </button>
          </div>
        </div>

        {enrichProgress && (
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-primary/10 border border-primary/30 px-3 py-2">
            <Loader2 size={13} className={enrichProgress.done < enrichProgress.total ? "animate-spin text-primary" : "text-primary"} />
            <span className="text-xs text-primary font-mono flex-1">
              {enrichProgress.done < enrichProgress.total
                ? `Scraping website ${enrichProgress.done + 1} of ${enrichProgress.total} · ${enrichProgress.found} email${enrichProgress.found === 1 ? "" : "s"} found so far`
                : `Done · ${enrichProgress.found} of ${enrichProgress.total} sites gave us an email`}
            </span>
            <div className="w-28 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round((enrichProgress.done / Math.max(1, enrichProgress.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {leads.length === 0 ? (
          <div className="text-center py-10 text-white/50 text-sm">
            No leads yet. Click <span className="text-white font-semibold">Run Apify scrape</span> above, or add a test lead with your own email.
          </div>
        ) : (
          <>
            <p className="text-[11px] text-white/45 mb-2 font-mono">
              {counters.leadsWithEmail} of {counters.leads} leads have email addresses.
              {counters.leads - counters.leadsWithEmail > 0 && ` ${counters.leads - counters.leadsWithEmail} will be skipped at generate time.`}
            </p>
            <div className="space-y-1">
              {leads.map((l) => (
                <div key={l.id} className="group flex items-center gap-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/[0.12] px-3 py-2 transition cursor-pointer"
                     onClick={() => setLeadDetail(l)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{l.name}</span>
                      {l.is_test && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent/20 border border-accent/40 text-accent text-[9px] font-bold tracking-wider uppercase">
                          <Beaker size={9} /> Test
                        </span>
                      )}
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/45">
                        {l.status}
                      </span>
                      {!l.email && !l.is_test && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                          no email
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-white/50 font-mono mt-0.5 flex-wrap">
                      {l.email && <span className="text-white/70">{l.email}</span>}
                      {l.category && <span>· {l.category}</span>}
                      {l.rating !== null && <span>· <Star size={9} className="inline -mt-0.5" /> {l.rating}{l.reviews_count ? ` (${l.reviews_count})` : ""}</span>}
                      {l.address && <span className="truncate max-w-[220px]">· {l.address}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {l.website && (
                      <a
                        href={l.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white flex items-center justify-center transition"
                        title={l.website}
                      >
                        <Globe size={12} />
                      </a>
                    )}
                    {l.maps_url && (
                      <a
                        href={l.maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white flex items-center justify-center transition"
                        title="View on Google Maps"
                      >
                        <MapPin size={12} />
                      </a>
                    )}
                    {l.phone && (
                      <a
                        href={`tel:${l.phone}`}
                        className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white flex items-center justify-center transition"
                        title={l.phone}
                      >
                        <Phone size={12} />
                      </a>
                    )}
                    <button
                      onClick={() => removeLead(l.id)}
                      className="w-8 h-8 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-300 flex items-center justify-center transition"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </GlassCard>

      {/* Email drafts */}
      <GlassCard className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-purple" />
          <h3 className="font-display text-sm tracking-widest uppercase text-white/75 font-bold">Emails</h3>
          <span className="text-xs font-mono text-white/50">({emails.length})</span>
        </div>
        {emails.length === 0 ? (
          <div className="text-center py-10 text-white/50 text-sm">
            {generateProgress ? (
              <div className="flex items-center justify-center gap-3 text-primary">
                <Loader2 size={14} className="animate-spin" />
                Generating email {generateProgress.done + 1} of {generateProgress.total}…
              </div>
            ) : (
              <>No drafts yet. Click <span className="text-white font-semibold">Generate emails</span> after leads are in.</>
            )}
          </div>
        ) : (
          <>
            {generateProgress && generateProgress.done < generateProgress.total && (
              <div className="mb-3 flex items-center gap-3 rounded-lg bg-primary/10 border border-primary/30 px-3 py-2">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-xs text-primary font-mono">
                  Generating {generateProgress.done + 1} of {generateProgress.total}…
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.round((generateProgress.done / generateProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              {emails.map((e) => (
                <div
                  key={e.id}
                  onClick={() => setEmailDetail(e)}
                  className="rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/[0.12] p-3 cursor-pointer transition"
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs text-white/50 font-mono">to</span>
                    <span className="text-sm text-white font-medium truncate">{e.to_email}</span>
                    <StatusPill status={e.status} />
                    {(e.click_count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent/15 border border-accent/30 text-accent text-[10px] font-bold">
                        <MousePointerClick size={10} /> {e.click_count}
                      </span>
                    )}
                    <ExternalLink size={11} className="ml-auto text-white/30" />
                  </div>
                  <p className="text-sm font-semibold text-white mb-0.5">{e.subject}</p>
                  <p className="text-xs text-white/55 line-clamp-2 whitespace-pre-wrap">{e.body_text}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </GlassCard>

      {/* Add test lead modal */}
      <AddTestLeadModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        campaignId={campaign.id}
        onAdded={() => void refresh()}
      />

      {/* Generate emails modal — per-lead with live progress */}
      <GenerateEmailsModal
        open={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        campaignId={campaign.id}
        leads={leads}
        existingEmails={emails}
        setBusyAction={setBusyAction}
        onComplete={() => void refresh()}
        setErr={setErr}
        progress={generateProgress}
        setProgress={setGenerateProgress}
      />

      {/* Lead detail */}
      {leadDetail && <LeadDetailModal lead={leadDetail} onClose={() => setLeadDetail(null)} />}

      {/* Email detail */}
      {emailDetail && <EmailDetailModal email={emailDetail} onClose={() => setEmailDetail(null)} />}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components

function ActionButton({
  onClick,
  disabled,
  busy,
  label,
  sublabel,
  icon,
  tint,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  tint: "primary" | "purple" | "accent";
}) {
  const tints: Record<typeof tint, string> = {
    primary: "from-primary/15 to-primary/5 border-primary/30 hover:border-primary/60 text-primary",
    purple: "from-purple/15 to-purple/5 border-purple/30 hover:border-purple/60 text-purple",
    accent: "from-accent/15 to-accent/5 border-accent/30 hover:border-accent/60 text-accent",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-xl p-4 bg-gradient-to-br ${tints[tint]} border transition disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {busy ? <Loader2 size={16} className="animate-spin" /> : icon}
        <span className="font-display text-sm font-bold tracking-wide text-white">{label}</span>
      </div>
      <p className="text-xs text-white/60">{sublabel}</p>
    </button>
  );
}

function MiniStat({ label, value, icon, tint }: { label: string; value: number; icon: React.ReactNode; tint: "primary" | "purple" | "accent" | "green" }) {
  const tints: Record<typeof tint, string> = {
    primary: "text-primary",
    purple: "text-purple",
    accent: "text-accent",
    green: "text-green-300",
  };
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2">
      <div className={`flex items-center gap-1.5 mb-0.5 ${tints[tint]}`}>{icon}<span className="text-[10px] uppercase tracking-widest font-bold">{label}</span></div>
      <div className="font-display text-xl font-black text-white tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    drafted: "bg-white/5 border-white/15 text-white/60",
    sent: "bg-primary/15 border-primary/40 text-primary",
    delivered: "bg-green-500/15 border-green-500/40 text-green-300",
    bounced: "bg-red-500/15 border-red-500/40 text-red-300",
    clicked: "bg-accent/15 border-accent/40 text-accent",
    replied: "bg-green-500/25 border-green-500/60 text-green-200",
    complained: "bg-red-500/15 border-red-500/40 text-red-300",
    failed: "bg-red-500/15 border-red-500/40 text-red-300",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-bold tracking-wider uppercase ${map[status] ?? "bg-white/5 border-white/10 text-white/50"}`}>
      {status}
    </span>
  );
}

function AddTestLeadModal({ open, onClose, campaignId, onAdded }: { open: boolean; onClose: () => void; campaignId: string; onAdded: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("Use this lead to test the full send → reply loop.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await call("outreach.leads.add_test", {
        campaign_id: campaignId,
        email: email.trim(),
        name: name.trim() || email.split("@")[0],
        notes,
      });
      setEmail("");
      setName("");
      onAdded();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a test lead" description="Seed your own email into this campaign so you can watch the send → reply loop end-to-end." maxWidth="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Your email" required hint="Replies to this address will appear in your dashboard within seconds.">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" required autoFocus />
        </FormField>
        <FormField label="Display name" hint="Optional — what the lead shows as in the table.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Test Lead" />
        </FormField>
        <FormField label="Notes" hint="Passed to Gemini as context for the draft.">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </FormField>
        {err && <div className="rounded-lg bg-red-500/15 border border-red-500/40 px-4 py-2 text-sm text-red-200">{err}</div>}
        <div className="flex items-center gap-3">
          <PrimaryButton type="submit" loading={busy} disabled={!email.trim() || busy}>
            <FlaskConical size={14} /> Add test lead
          </PrimaryButton>
          <button type="button" onClick={onClose} className="px-4 py-3 text-sm text-white/60 hover:text-white font-medium">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function GenerateEmailsModal({
  open,
  onClose,
  campaignId,
  leads,
  existingEmails,
  setBusyAction,
  onComplete,
  setErr,
  progress,
  setProgress,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  leads: Lead[];
  existingEmails: EmailRow[];
  setBusyAction: (v: "run" | "generate" | "send" | null) => void;
  onComplete: () => void;
  setErr: (s: string | null) => void;
  progress: { done: number; total: number } | null;
  setProgress: (p: { done: number; total: number } | null) => void;
}) {
  const [senderName, setSenderName] = useState("");
  const [senderCompany, setSenderCompany] = useState("");
  const [senderOffer, setSenderOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  // Compute eligible leads each render so the user sees a live count.
  const existingLeadIds = new Set(existingEmails.map((e) => e.lead_id));
  const eligibleLeads = leads.filter((l) => l.email && !existingLeadIds.has(l.id));
  const skippedNoEmail = leads.filter((l) => !l.email).length;
  const skippedNoEmailButWebsite = leads.filter((l) => !l.email && l.website).length;
  const skippedAlreadyDrafted = leads.filter((l) => l.email && existingLeadIds.has(l.id)).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!senderOffer.trim() || eligibleLeads.length === 0) return;
    setBusy(true);
    setBusyAction("generate");
    setLocalErr(null);
    setErr(null);
    setProgress({ done: 0, total: eligibleLeads.length });
    let done = 0;
    const errors: Array<{ lead_id: string; error: string }> = [];
    try {
      for (const lead of eligibleLeads) {
        try {
          await call("outreach.emails.generate_one", {
            campaign_id: campaignId,
            lead_id: lead.id,
            sender_name: senderName,
            sender_company: senderCompany,
            sender_offer: senderOffer,
          });
        } catch (err) {
          errors.push({ lead_id: lead.id, error: err instanceof Error ? err.message : "unknown" });
        }
        done++;
        setProgress({ done, total: eligibleLeads.length });
        // Refresh the campaign detail view every 3 drafts so the user
        // watches drafts appear in real time.
        if (done % 3 === 0 || done === eligibleLeads.length) onComplete();
      }
      if (errors.length > 0 && done - errors.length === 0) {
        setLocalErr(`All ${errors.length} drafts failed. First error: ${errors[0]?.error ?? "unknown"}`);
        setErr(errors[0]?.error ?? "Drafts failed");
      } else {
        // Close modal on success (full or partial).
        onClose();
        // Clear progress after a short beat so the campaign page can
        // celebrate the final count.
        setTimeout(() => setProgress(null), 1200);
      }
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate emails"
      description="Gemini drafts one personalised first-touch per lead with an email. Progress updates live."
      maxWidth="max-w-lg"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.08] p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-white/70">Leads ready to draft</span>
            <span className="font-mono font-bold text-primary">{eligibleLeads.length}</span>
          </div>
          {skippedNoEmail > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-amber-300/80">Leads without an email (skipped)</span>
              <span className="font-mono text-amber-300">{skippedNoEmail}</span>
            </div>
          )}
          {skippedNoEmailButWebsite > 0 && (
            <div className="pt-2 mt-1 border-t border-white/5 text-[11px] text-white/60">
              💡 Tip: {skippedNoEmailButWebsite} of those have websites. Close this and click
              <span className="font-semibold text-primary"> Find emails </span>
              in the Leads card to scrape them first — usually recovers 40–70%.
            </div>
          )}
          {skippedAlreadyDrafted > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-white/50">Already drafted (skipped)</span>
              <span className="font-mono text-white/50">{skippedAlreadyDrafted}</span>
            </div>
          )}
        </div>

        <FormField label="Your name" hint="Signed at the bottom of the email.">
          <TextInput value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="e.g. Mani" autoFocus />
        </FormField>
        <FormField label="Your company" hint="Optional — mentioned as credibility anchor.">
          <TextInput value={senderCompany} onChange={(e) => setSenderCompany(e.target.value)} placeholder="e.g. Vertical AI" />
        </FormField>
        <FormField label="Value / offer" hint="One sentence describing what you're offering. Gemini shapes the hook around this." required>
          <TextArea value={senderOffer} onChange={(e) => setSenderOffer(e.target.value)} rows={3} placeholder="e.g. We ship AI voice agents for SMBs in 30 days, flat-fee, no retainer." required />
        </FormField>

        {progress && (
          <div className="rounded-lg bg-primary/10 border border-primary/30 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-primary mb-1.5">
              <Loader2 size={12} className="animate-spin" />
              <span className="font-mono">
                Drafting {progress.done} of {progress.total}…
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {localErr && (
          <div className="rounded-lg bg-red-500/15 border border-red-500/40 px-4 py-2 text-sm text-red-200">{localErr}</div>
        )}

        <div className="flex items-center gap-3">
          <PrimaryButton type="submit" loading={busy} disabled={!senderOffer.trim() || busy || eligibleLeads.length === 0}>
            <Sparkles size={14} /> Generate {eligibleLeads.length} draft{eligibleLeads.length === 1 ? "" : "s"}
          </PrimaryButton>
          <button type="button" onClick={onClose} className="px-4 py-3 text-sm text-white/60 hover:text-white font-medium">
            {busy ? "Close (keeps running)" : "Cancel"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={lead.name}
      description={lead.is_test ? "🧪 Test lead — seeded by you for the send→reply demo." : "Lead scraped by Apify from Google Maps."}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Contact block */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <DetailRow label="Email" value={lead.email} mono />
          <DetailRow label="Phone" value={lead.phone} mono href={lead.phone ? `tel:${lead.phone}` : null} />
          <DetailRow label="Website" value={lead.website} href={lead.website} external />
          <DetailRow label="Google Maps" value={lead.maps_url ? "View on Google Maps" : null} href={lead.maps_url} external />
        </div>

        {/* Metadata block */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <DetailRow label="Category" value={lead.category} />
          <DetailRow label="Rating" value={lead.rating !== null ? `★ ${lead.rating}${lead.reviews_count ? ` (${lead.reviews_count} reviews)` : ""}` : null} />
          <DetailRow label="Address" value={lead.address} full />
        </div>

        {lead.notes && <DetailRow label="Notes" value={lead.notes} full />}

        {/* Raw Apify data — collapsed by default */}
        {lead.raw && Object.keys(lead.raw).length > 0 && (
          <details className="rounded-lg bg-black/30 border border-white/[0.06]">
            <summary className="cursor-pointer px-3 py-2 text-xs text-white/60 font-mono hover:text-white/85 transition">
              Raw Apify data ({Object.keys(lead.raw).length} fields)
            </summary>
            <pre className="px-3 pb-3 text-[10px] text-white/70 overflow-x-auto max-h-80 font-mono">
              {JSON.stringify(lead.raw, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </Modal>
  );
}

function EmailDetailModal({ email, onClose }: { email: EmailRow; onClose: () => void }) {
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={email.subject || "(no subject)"}
      description={`to ${email.to_email}`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={email.status} />
          {(email.click_count ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/15 border border-accent/30 text-accent text-xs font-bold">
              <MousePointerClick size={11} /> {email.click_count} click{email.click_count === 1 ? "" : "s"}
            </span>
          )}
          <span className="text-[11px] text-white/40 font-mono ml-auto">
            Created {new Date(email.created_at).toLocaleString()}
          </span>
        </div>

        <div className="rounded-lg bg-black/30 border border-white/[0.06] p-4 max-h-[60vh] overflow-y-auto">
          {email.body_html ? (
            <div
              className="prose prose-invert prose-sm max-w-none text-white/85 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: email.body_html }}
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm text-white/85 leading-relaxed">{email.body_text}</pre>
          )}
        </div>

        <details className="rounded-lg bg-black/20 border border-white/[0.04]">
          <summary className="cursor-pointer px-3 py-2 text-xs text-white/50 font-mono hover:text-white/80 transition">
            Plain text version
          </summary>
          <pre className="px-3 pb-3 text-[11px] text-white/60 whitespace-pre-wrap font-mono">{email.body_text}</pre>
        </details>
      </div>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  mono,
  href,
  external,
  full,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  href?: string | null;
  external?: boolean;
  full?: boolean;
}) {
  if (!value) return null;
  const content = href ? (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="text-primary hover:text-white transition inline-flex items-center gap-1"
    >
      <span className="truncate">{value}</span>
      {external && <ExternalLink size={11} className="shrink-0" />}
    </a>
  ) : (
    <span className="text-white/85 truncate">{value}</span>
  );
  return (
    <div className={`${full ? "col-span-full" : ""} rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-0.5">{label}</div>
      <div className={`text-sm ${mono ? "font-mono" : ""} truncate`}>{content}</div>
    </div>
  );
}

// Unused import guards
void Check;
void X;

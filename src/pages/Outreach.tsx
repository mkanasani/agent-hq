import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Target,
  Search,
  MapPin,
  Trash2,
  AlertCircle,
  Mail,
  MousePointerClick,
  MessageSquare,
  Users,
  Sparkles,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import OutreachWizard from "@/components/OutreachWizard";
import OnboardingWizard from "@/components/OnboardingWizard";
import WebhookSetupCard from "@/components/WebhookSetupCard";
import SkillViewerModal from "@/components/SkillViewerModal";
import { call } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import outreachSkillMd from "../../skills/mission-control-outreach.md?raw";

type Campaign = {
  id: string;
  name: string;
  query: string;
  description?: string;
  structured_query: { location: string; searchTerms: string[]; maxResults: number } | null;
  status: "draft" | "searching" | "ready" | "sending" | "completed" | "failed";
  total_leads_found: number;
  leads_imported: number;
  emails_generated: number;
  emails_sent: number;
  emails_delivered: number;
  emails_bounced: number;
  emails_clicked: number;
  emails_replied: number;
  created_at: string;
  updated_at: string;
};

type ConfigStatus = Record<string, { configured: boolean }>;

const STATUS_COLORS: Record<Campaign["status"], string> = {
  draft: "bg-white/10 border-white/20 text-white/70",
  searching: "bg-primary/15 border-primary/40 text-primary",
  ready: "bg-accent/15 border-accent/40 text-accent",
  sending: "bg-purple/15 border-purple/40 text-purple",
  completed: "bg-green-500/15 border-green-500/40 text-green-300",
  failed: "bg-red-500/15 border-red-500/40 text-red-300",
};

export default function Outreach() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  // Auto-pop onboarding once per browser if any outreach-relevant key is missing.
  // Mirrors the pattern Voice page uses: the feature that needs the key
  // triggers the ask, not the whole app.
  useEffect(() => {
    if (!loaded || !config) return;
    if (localStorage.getItem("agent_hq_outreach_onboarding_dismissed") === "1") return;
    const missing = ["gemini", "apify", "agentmail"].some((k) => !config[k]?.configured);
    if (missing) setOnboardingOpen(true);
  }, [loaded, config]);

  function closeOnboarding() {
    localStorage.setItem("agent_hq_outreach_onboarding_dismissed", "1");
    setOnboardingOpen(false);
    void refresh();
  }

  async function refresh() {
    try {
      const [list, cfg] = await Promise.all([
        call<Campaign[]>("outreach.campaign.list"),
        call<ConfigStatus>("config.status"),
      ]);
      setCampaigns(list);
      setConfig(cfg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoaded(true);
    }
  }

  async function removeCampaign(id: string, name: string) {
    if (!confirm(`Delete campaign "${name}"? Leads and emails become inaccessible.`)) return;
    try {
      await call("outreach.campaign.delete", { id });
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const missingKeys: string[] = [];
  if (config && !config.gemini?.configured) missingKeys.push("Gemini");
  if (config && !config.apify?.configured) missingKeys.push("Apify");
  if (config && !config.agentmail?.configured) missingKeys.push("AgentMail");

  const empty = loaded && campaigns.length === 0;

  // Aggregate "flywheel" counters across all campaigns.
  const totals = campaigns.reduce(
    (acc, c) => {
      acc.leads += c.leads_imported ?? 0;
      acc.emails += c.emails_sent ?? 0;
      acc.clicks += c.emails_clicked ?? 0;
      acc.replies += c.emails_replied ?? 0;
      return acc;
    },
    { leads: 0, emails: 0, clicks: 0, replies: 0 },
  );

  return (
    <>
      <PageHeader
        title="Outreach"
        subtitle="Describe your ICP in one sentence. Your agent finds real businesses, drafts personalised emails, sends from its own inbox, and routes replies back to your kanban."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSkillOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-accent/25 to-purple/25 border border-accent/50 text-white hover:border-accent/80 transition font-bold tracking-wide shadow-glow-accent"
            >
              <Sparkles size={16} strokeWidth={2.5} /> Teach Your Agent
            </button>
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition font-bold tracking-wide"
            >
              <Plus size={16} /> New campaign
            </button>
          </div>
        }
      />

      {/* Missing-keys nudge */}
      {loaded && missingKeys.length > 0 && (
        <GlassCard className="mb-5 bg-gradient-to-br from-accent/[0.08] to-purple/[0.08] border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center shrink-0">
              <AlertCircle size={18} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/90 font-semibold mb-0.5">
                Connect {missingKeys.join(" + ")} to unlock the full flywheel
              </p>
              <p className="text-xs text-white/65">
                Gemini powers the preview. Apify scrapes leads. AgentMail sends &amp; tracks. All free tier.
              </p>
            </div>
            <Link
              to="/settings"
              className="shrink-0 px-4 py-2 rounded-lg bg-primary/25 hover:bg-primary/35 border border-primary/50 text-primary text-xs font-bold tracking-wide transition"
            >
              Open Settings →
            </Link>
          </div>
        </GlassCard>
      )}

      {err && (
        <GlassCard className="mb-5 border-red-500/40 bg-red-500/10">
          <div className="flex items-center gap-3 text-red-200">
            <AlertCircle size={18} />
            <span className="text-sm font-medium">{err}</span>
          </div>
        </GlassCard>
      )}

      {/* Webhook setup — shows only if keys are all set and webhook isn't live yet */}
      {loaded && missingKeys.length === 0 && <WebhookSetupCard />}

      {/* Flywheel stats */}
      {loaded && campaigns.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={<Users size={18} />} label="Leads" value={totals.leads} tint="primary" />
          <StatCard icon={<Mail size={18} />} label="Emails sent" value={totals.emails} tint="purple" />
          <StatCard icon={<MousePointerClick size={18} />} label="Clicks" value={totals.clicks} tint="accent" />
          <StatCard icon={<MessageSquare size={18} />} label="Replies" value={totals.replies} tint="green" />
        </div>
      )}

      {/* Campaigns list */}
      {empty && (
        <GlassCard className="text-center py-16 bg-gradient-to-br from-primary/[0.04] to-purple/[0.04] border-white/10">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-5 shadow-glow">
            <Target size={28} className="text-primary" />
          </div>
          <h3 className="font-display text-2xl font-bold text-white mb-2">Your first campaign in one sentence.</h3>
          <p className="text-sm text-white/65 max-w-md mx-auto mb-6">
            Type "dental clinics in Austin, 4-star+" and your agent turns it into a list of real prospects,
            personalised drafts, and a live send from its own inbox.
          </p>
          <button
            onClick={() => setWizardOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-black font-display font-black tracking-widest text-sm uppercase shadow-glow hover:bg-primary/90 transition"
          >
            <Sparkles size={14} /> Describe your ICP
          </button>
        </GlassCard>
      )}

      {!empty && (
        <div className="grid gap-4">
          {campaigns.map((c) => (
            <GlassCard key={c.id} hover className="bg-gradient-to-br from-white/[0.02] to-white/[0.005] !p-0">
              <div className="flex items-start gap-5 p-6">
                <Link to={`/outreach/${c.id}`} className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 hover:border-primary/60 transition">
                  <Target size={20} className="text-primary" />
                </Link>

                <Link to={`/outreach/${c.id}`} className="flex-1 min-w-0 space-y-2 hover:text-white">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-base font-bold text-white truncate">{c.name}</h3>
                    <span
                      className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase tracking-wider ${STATUS_COLORS[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </div>

                  {c.description && (
                    <p className="text-xs text-white/55">{c.description}</p>
                  )}

                  <p className="text-sm text-white/70 italic line-clamp-2">"{c.query}"</p>

                  {c.structured_query && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/25 text-primary text-[11px] font-mono">
                        <MapPin size={10} /> {c.structured_query.location}
                      </span>
                      {c.structured_query.searchTerms.slice(0, 3).map((t, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/65 text-[11px] font-mono"
                        >
                          <Search size={10} /> {t}
                        </span>
                      ))}
                      {c.structured_query.searchTerms.length > 3 && (
                        <span className="text-[11px] text-white/40 font-mono">
                          +{c.structured_query.searchTerms.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-[11px] text-white/55 font-mono pt-1">
                    <span>{c.leads_imported} leads</span>
                    <span>·</span>
                    <span>{c.emails_sent} sent</span>
                    <span>·</span>
                    <span>{c.emails_replied} replied</span>
                    <span>·</span>
                    <span>{timeAgo(c.created_at)}</span>
                  </div>
                </Link>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/outreach/${c.id}`}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-xs font-bold tracking-wide transition"
                  >
                    Open →
                  </Link>
                  <button
                    onClick={() => removeCampaign(c.id, c.name)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold transition"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <OutreachWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => void refresh()}
      />

      <OnboardingWizard
        open={onboardingOpen}
        onClose={closeOnboarding}
        onlyMissing
        onComplete={() => void refresh()}
      />

      <SkillViewerModal
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
        title="Outreach Skill — ICP to leads to sends to tracked replies"
        description="Paste this into your OpenClaw, Claude Code, Hermes, or any agent runtime. It teaches your agent to drive the whole machine: NL preview → Apify scrape → email enrichment → Gemini drafts → AgentMail send → reply loop. Two hard approval gates baked in."
        skillMarkdown={outreachSkillMd}
      />
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tint: "primary" | "purple" | "accent" | "green";
}) {
  const tints: Record<typeof tint, string> = {
    primary: "from-primary/15 to-primary/5 border-primary/25 text-primary",
    purple: "from-purple/15 to-purple/5 border-purple/25 text-purple",
    accent: "from-accent/15 to-accent/5 border-accent/25 text-accent",
    green: "from-green-500/15 to-green-500/5 border-green-500/25 text-green-300",
  };
  return (
    <div className={`rounded-xl p-4 bg-gradient-to-br ${tints[tint]} border`}>
      <div className="flex items-center gap-2 mb-2 opacity-90">{icon}</div>
      <div className="font-display text-2xl font-black text-white tracking-tight">{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/60 font-semibold mt-0.5">{label}</div>
    </div>
  );
}

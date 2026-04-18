import { useState } from "react";
import Modal, { FormField, TextInput, TextArea, PrimaryButton } from "./Modal";
import { call } from "@/lib/api";
import type { Page } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (page: Page) => void;
};

const DEFAULT_HTML = `<section class="hero">
  <span class="eyebrow">Your Brand</span>
  <h1>A headline that stops the scroll.</h1>
  <p>One or two sentences that make the value unmistakable.</p>
  <div class="cta-row">
    <a href="#contact" class="button">Get in touch</a>
    <a href="#features" class="button ghost">Learn more</a>
  </div>
</section>

<section id="features" class="features">
  <div class="card">
    <h3>Feature one</h3>
    <p>Why it matters.</p>
  </div>
  <div class="card">
    <h3>Feature two</h3>
    <p>How it helps.</p>
  </div>
  <div class="card">
    <h3>Feature three</h3>
    <p>The proof point.</p>
  </div>
</section>

{{form:contact}}
`;

export default function NewPageModal({ open, onClose, onCreated }: Props) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [htmlBody, setHtmlBody] = useState(DEFAULT_HTML);
  const [linkedFormSlug, setLinkedFormSlug] = useState("");
  const [accent, setAccent] = useState("#00BFFF");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !title.trim() || !htmlBody.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const page = await call<Page>("page.create", {
        slug: slug.trim(),
        title: title.trim(),
        html_body: htmlBody.trim(),
        linked_form_slug: linkedFormSlug.trim() || null,
        accent: accent.trim() || null,
      });
      onCreated(page);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setSlug("");
    setTitle("");
    setHtmlBody(DEFAULT_HTML);
    setLinkedFormSlug("");
    setAccent("#00BFFF");
    setError(null);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Create Landing Page"
      description="Paste HTML for the body — the theme wraps it with typography, layout, and glow. Use {{form:slug}} to embed a form inline."
      maxWidth="max-w-3xl"
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Slug" required hint="URL path — lowercase, dashes only">
            <TextInput
              autoFocus
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="my-portfolio"
              required
            />
          </FormField>
          <FormField label="Title" required>
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Portfolio"
              required
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Linked Form Slug" hint="Optional — the page embeds this form inline">
            <TextInput
              value={linkedFormSlug}
              onChange={(e) => setLinkedFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="contact"
            />
          </FormField>
          <FormField label="Accent Color" hint="Used for headings, buttons, glows">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer"
              />
              <TextInput value={accent} onChange={(e) => setAccent(e.target.value)} className="flex-1" />
            </div>
          </FormField>
        </div>

        <FormField
          label="HTML Body"
          required
          hint="Use class names: .hero, .features, .card, .button, .stat, .eyebrow, .cta-row, footer"
        >
          <TextArea
            rows={12}
            value={htmlBody}
            onChange={(e) => setHtmlBody(e.target.value)}
            className="font-mono text-xs"
          />
        </FormField>

        {error && <p className="text-sm text-danger font-semibold mb-3">{error}</p>}

        <div className="flex items-center gap-3 mt-2">
          <PrimaryButton type="submit" loading={loading}>
            Publish Page
          </PrimaryButton>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="px-4 py-3 text-sm text-white/70 hover:text-white font-display font-bold uppercase tracking-widest"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

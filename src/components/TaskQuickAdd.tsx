import { useEffect, useRef, useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { call } from "@/lib/api";
import type { Task } from "@/lib/types";

type Props = {
  onAdded: (task: Task) => void;
};

export default function TaskQuickAdd({ onAdded }: Props) {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setActive(false);
      return;
    }
    setLoading(true);
    try {
      const task = await call<Task>("task.create", { title: trimmed });
      onAdded(task);
      setTitle("");
      setActive(false);
    } catch {
      // Local-only fallback (no API key yet) — build a fake task so UI stays responsive
      onAdded({
        id: `local-${Date.now()}`,
        title: trimmed,
        description: null,
        status: "todo",
        assignee_id: null,
        priority: "medium",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setTitle("");
      setActive(false);
    } finally {
      setLoading(false);
    }
  }

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="w-full rounded-xl border-2 border-dashed border-white/15 hover:border-primary/60 text-white/70 hover:text-white hover:bg-primary/[0.06] transition-all py-4 px-4 flex items-center justify-center gap-2 font-display text-xs tracking-widest uppercase font-bold"
      >
        <Plus size={16} strokeWidth={2.5} />
        Add a task
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-primary/60 bg-primary/[0.08] p-3 shadow-glow">
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") {
            setTitle("");
            setActive(false);
          }
        }}
        placeholder="What should your agents work on?"
        className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/50 font-medium"
      />
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => void submit()}
          disabled={loading || !title.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/90 hover:bg-primary text-black font-bold text-xs tracking-widest uppercase transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={14} strokeWidth={3} />
          Add
        </button>
        <button
          onClick={() => {
            setTitle("");
            setActive(false);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/5 text-xs tracking-widest uppercase font-bold transition"
        >
          <X size={14} strokeWidth={3} />
          Cancel
        </button>
      </div>
    </div>
  );
}

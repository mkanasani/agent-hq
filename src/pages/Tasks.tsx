import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import TaskQuickAdd from "@/components/TaskQuickAdd";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/types";

const COLUMNS: { status: TaskStatus; label: string; accent: string }[] = [
  { status: "todo", label: "To Do", accent: "from-white/10 to-white/0" },
  { status: "doing", label: "Doing", accent: "from-primary/25 to-primary/0" },
  { status: "needs_input", label: "Needs Input", accent: "from-amber/25 to-amber/0" },
  { status: "canceled", label: "Canceled", accent: "from-danger/20 to-danger/0" },
  { status: "done", label: "Done", accent: "from-success/25 to-success/0" },
];

const SEED: Task[] = [
  { id: "1", title: "Research Acme Corp before Thursday demo", description: null, status: "doing", assignee_id: null, priority: "high", created_at: "", updated_at: "" },
  { id: "2", title: "Draft launch announcement email", description: null, status: "todo", assignee_id: null, priority: "medium", created_at: "", updated_at: "" },
  { id: "3", title: "Approve new onboarding copy", description: null, status: "needs_input", assignee_id: null, priority: "high", created_at: "", updated_at: "" },
  { id: "4", title: "Summarize last 3 sales calls", description: null, status: "done", assignee_id: null, priority: "low", created_at: "", updated_at: "" },
  { id: "5", title: "Qualify 12 inbound leads from form", description: null, status: "doing", assignee_id: null, priority: "medium", created_at: "", updated_at: "" },
];

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      const list = await call<Task[]>("task.list");
      setTasks(list);
    } catch {
      // keep seed
    }
  }

  const display = tasks.length > 0 ? tasks : SEED;

  const grouped = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.status, [] as Task[]]));
    for (const t of display) map[t.status]?.push(t);
    return map;
  }, [display]);

  function handleAdded(task: Task) {
    setTasks((prev) => [task, ...prev]);
  }

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Every card is work your agents are doing — or waiting on you for."
      />

      <div className="grid grid-cols-5 gap-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex flex-col gap-3">
            <div className={cn("glass p-3 bg-gradient-to-b", col.accent)}>
              <div className="flex items-center justify-between">
                <span className="font-display text-xs tracking-widest uppercase text-white font-bold">
                  {col.label}
                </span>
                <span className="text-xs text-white/70 font-mono font-bold">{grouped[col.status]?.length ?? 0}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 min-h-[100px]">
              {col.status === "todo" && <TaskQuickAdd onAdded={handleAdded} />}
              {grouped[col.status]?.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TaskCard({ task }: { task: Task }) {
  const priorityColor =
    task.priority === "high" ? "bg-danger" : task.priority === "medium" ? "bg-primary" : "bg-white/50";
  return (
    <GlassCard hover className="p-4 cursor-grab active:cursor-grabbing">
      <div className="flex items-start gap-3">
        <span className={cn("w-1.5 h-1.5 rounded-full mt-2 shrink-0", priorityColor)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium leading-snug">{task.title}</p>
          <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/65 font-bold">
            <span>{task.priority}</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

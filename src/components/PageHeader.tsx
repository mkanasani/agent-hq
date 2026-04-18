import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
};

export default function PageHeader({ title, subtitle, right }: Props) {
  return (
    <div className="flex items-end justify-between mb-8 gap-6">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="text-white/75 mt-3 max-w-2xl font-medium">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

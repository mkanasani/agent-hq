import type { ReactNode, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  hover?: boolean;
};

export default function GlassCard({ children, className, hover, ...rest }: Props) {
  return (
    <div className={cn("glass p-6", hover && "glass-hover", className)} {...rest}>
      {children}
    </div>
  );
}

import { motion } from "framer-motion";
import type { Agent } from "@/lib/types";
import StatusRing from "./StatusRing";

type Props = {
  agent: Agent;
  x: number; // percentage
  y: number; // percentage
  delay?: number;
};

export default function AgentSprite({ agent, x, y, delay = 0 }: Props) {
  return (
    <motion.div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.8, ease: "easeOut" }}
    >
      <div className="flex flex-col items-center gap-3 float-y" style={{ animationDelay: `${delay}s` }}>
        <StatusRing status={agent.status} size={72}>
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${agent.color}55, ${agent.color}15 60%, transparent)`,
              border: `1px solid ${agent.color}66`,
            }}
          >
            <span>{agent.emoji}</span>
          </div>
        </StatusRing>
        <div className="glass px-3 py-1.5 min-w-[110px] text-center">
          <div className="font-display text-xs tracking-widest text-white font-bold">{agent.name}</div>
          <div className="text-[10px] text-white/75 uppercase tracking-widest font-semibold">{agent.role}</div>
        </div>
      </div>
    </motion.div>
  );
}

"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface MasteryRingProps {
  percentage: number;
  label: string;
  size?: number;
  color?: string;
}

export default function MasteryRing({
  percentage,
  label,
  size = 120,
  color = "var(--qb-primary)",
}: MasteryRingProps) {
  const data = [
    { name: "Mastered", value: percentage },
    { name: "Remaining", value: 100 - percentage },
  ];

  return (
    <div style={{ width: size, height: size, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="75%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="var(--qb-border)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1 }}>{percentage}%</span>
        <span style={{ fontSize: "0.75rem", color: "var(--qb-text-secondary)", marginTop: 4 }}>{label}</span>
      </div>
    </div>
  );
}

"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  name: string;
  score: number;
}

interface TrendChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  yAxisLabel?: string;
}

export default function TrendChart({
  data,
  height = 250,
  color = "var(--qb-primary)",
  yAxisLabel = "Score",
}: TrendChartProps) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--qb-border)" />
          <XAxis 
            dataKey="name" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "var(--qb-text-secondary)", fontSize: 12 }} 
            dy={10} 
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "var(--qb-text-secondary)", fontSize: 12 }} 
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: "var(--qb-surface)", 
              borderRadius: "8px", 
              border: "1px solid var(--qb-border)",
              boxShadow: "0 4px 12px var(--qb-shadow)"
            }}
            itemStyle={{ color: "var(--qb-text-primary)", fontWeight: 600 }}
          />
          <Line 
            type="monotone" 
            dataKey="score" 
            name={yAxisLabel}
            stroke={color} 
            strokeWidth={3}
            dot={{ r: 4, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

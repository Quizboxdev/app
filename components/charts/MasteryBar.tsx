"use client";

interface MasteryBarProps {
  label: string;
  percentage: number;
  color?: string;
  showValue?: boolean;
}

export default function MasteryBar({
  label,
  percentage,
  color = "var(--qb-primary)",
  showValue = true,
}: MasteryBarProps) {
  // Clamp percentage between 0 and 100
  const clamped = Math.min(Math.max(percentage, 0), 100);
  
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.875rem" }}>
        <span style={{ fontWeight: 600, color: "var(--qb-text-primary)" }}>{label}</span>
        {showValue && <span style={{ color: "var(--qb-text-secondary)" }}>{clamped}%</span>}
      </div>
      <div style={{ width: "100%", height: "8px", background: "var(--qb-surface-muted)", borderRadius: "999px", overflow: "hidden" }}>
        <div 
          style={{ 
            width: `${clamped}%`, 
            height: "100%", 
            background: color,
            borderRadius: "999px",
            transition: "width 0.5s ease-in-out"
          }} 
        />
      </div>
    </div>
  );
}

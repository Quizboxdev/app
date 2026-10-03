"use client";

import { ReactNode } from "react";
import { Award, Star, Zap, Shield, Trophy } from "lucide-react";

export type BadgeTier = "gold" | "silver" | "bronze" | "standard";
export type BadgeType = "championship" | "mastery" | "streak" | "perfect";

interface AchievementBadgeProps {
  type: BadgeType;
  tier?: BadgeTier;
  label: string;
  subtext?: string;
  size?: "sm" | "md" | "lg";
}

const TIER_COLORS: Record<BadgeTier, { bg: string; color: string; border: string }> = {
  gold: { bg: "#FFF9C4", color: "#F57F17", border: "#FBC02D" },
  silver: { bg: "#F5F5F5", color: "#616161", border: "#E0E0E0" },
  bronze: { bg: "#EFEBE9", color: "#5D4037", border: "#D7CCC8" },
  standard: { bg: "var(--qb-surface-muted)", color: "var(--qb-primary)", border: "var(--qb-border)" },
};

const TYPE_ICONS: Record<BadgeType, ReactNode> = {
  championship: <Trophy size="100%" />,
  mastery: <Shield size="100%" />,
  streak: <Zap size="100%" />,
  perfect: <Star size="100%" />,
};

const SIZE_STYLES = {
  sm: { iconBox: 32, fontSize: "0.75rem" },
  md: { iconBox: 48, fontSize: "0.875rem" },
  lg: { iconBox: 80, fontSize: "1rem" },
};

export default function AchievementBadge({
  type,
  tier = "standard",
  label,
  subtext,
  size = "md",
}: AchievementBadgeProps) {
  const styles = TIER_COLORS[tier];
  const dimensions = SIZE_STYLES[size];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", textAlign: "center" }}>
      <div 
        style={{
          width: dimensions.iconBox,
          height: dimensions.iconBox,
          borderRadius: "50%",
          backgroundColor: styles.bg,
          border: `2px solid ${styles.border}`,
          color: styles.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: size === "lg" ? "16px" : "8px",
          boxShadow: tier !== "standard" ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
        }}
        aria-label={`${tier} ${type} badge`}
      >
        {TYPE_ICONS[type]}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong style={{ fontSize: dimensions.fontSize, color: "var(--qb-text-primary)", lineHeight: 1.2 }}>
          {label}
        </strong>
        {subtext && (
          <span style={{ fontSize: "0.75rem", color: "var(--qb-text-secondary)", lineHeight: 1.2 }}>
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
}

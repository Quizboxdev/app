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
  gold: { bg: "rgba(251, 191, 36, 0.15)", color: "var(--color-gold)", border: "var(--color-gold)" },
  silver: { bg: "rgba(148, 163, 184, 0.15)", color: "var(--color-silver)", border: "var(--color-silver)" },
  bronze: { bg: "rgba(180, 83, 9, 0.15)", color: "var(--color-bronze)", border: "var(--color-bronze)" },
  standard: { bg: "var(--qb-surface-muted)", color: "var(--qb-primary)", border: "var(--qb-primary)" },
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
          clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
          backgroundColor: tier === "standard" ? "var(--color-primary)" : styles.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: size === "lg" ? "16px" : "8px",
          color: "#fff",
        }}
        aria-label={`${tier} ${type} badge`}
      >
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {TYPE_ICONS[type]}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong style={{ fontSize: dimensions.fontSize, color: "var(--color-text)", lineHeight: 1.2 }}>
          {label}
        </strong>
        {subtext && (
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", lineHeight: 1.2 }}>
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
}

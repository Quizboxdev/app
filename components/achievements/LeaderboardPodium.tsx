"use client";

import AchievementBadge from "./AchievementBadge";

export interface PodiumParticipant {
  id: string;
  name: string;
  score: number;
  school?: string;
}

interface LeaderboardPodiumProps {
  firstPlace: PodiumParticipant;
  secondPlace?: PodiumParticipant;
  thirdPlace?: PodiumParticipant;
}

export default function LeaderboardPodium({
  firstPlace,
  secondPlace,
  thirdPlace,
}: LeaderboardPodiumProps) {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: "16px", padding: "32px 0", minHeight: "280px" }}>
      
      {/* 2nd Place */}
      {secondPlace && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "120px" }}>
          <AchievementBadge type="championship" tier="silver" label={secondPlace.name} subtext={`${secondPlace.score} pts`} size="md" />
          <div style={{ width: "100%", height: "100px", backgroundColor: "var(--track)", borderRadius: "8px 8px 0 0", borderTop: "4px solid var(--line-strong)", display: "flex", justifyContent: "center", paddingTop: "16px", fontWeight: 800, color: "var(--ink-muted)", fontSize: "2rem" }}>
            2
          </div>
        </div>
      )}

      {/* 1st Place */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "140px", zIndex: 10 }}>
        <AchievementBadge type="championship" tier="gold" label={firstPlace.name} subtext={`${firstPlace.score} pts`} size="lg" />
        <div style={{ width: "100%", height: "140px", backgroundColor: "var(--amber-wash)", borderRadius: "8px 8px 0 0", borderTop: "4px solid var(--gold)", display: "flex", justifyContent: "center", paddingTop: "16px", fontWeight: 800, color: "var(--amber-text)", fontSize: "3rem", boxShadow: "0 -4px 16px rgba(245,158,11,0.2)" }}>
          1
        </div>
      </div>

      {/* 3rd Place */}
      {thirdPlace && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "120px" }}>
          <AchievementBadge type="championship" tier="bronze" label={thirdPlace.name} subtext={`${thirdPlace.score} pts`} size="md" />
          <div style={{ width: "100%", height: "80px", backgroundColor: "var(--amber-tint)", borderRadius: "8px 8px 0 0", borderTop: "4px solid var(--bronze)", display: "flex", justifyContent: "center", paddingTop: "16px", fontWeight: 800, color: "var(--bronze)", fontSize: "2rem" }}>
            3
          </div>
        </div>
      )}
      
    </div>
  );
}

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
          <div style={{ width: "100%", height: "100px", backgroundColor: "#F5F5F5", borderRadius: "8px 8px 0 0", borderTop: "4px solid #E0E0E0", display: "flex", justifyContent: "center", paddingTop: "16px", fontWeight: 800, color: "#9E9E9E", fontSize: "2rem" }}>
            2
          </div>
        </div>
      )}

      {/* 1st Place */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "140px", zIndex: 10 }}>
        <AchievementBadge type="championship" tier="gold" label={firstPlace.name} subtext={`${firstPlace.score} pts`} size="lg" />
        <div style={{ width: "100%", height: "140px", backgroundColor: "#FFFDE7", borderRadius: "8px 8px 0 0", borderTop: "4px solid #FBC02D", display: "flex", justifyContent: "center", paddingTop: "16px", fontWeight: 800, color: "#F57F17", fontSize: "3rem", boxShadow: "0 -4px 16px rgba(251,192,45,0.2)" }}>
          1
        </div>
      </div>

      {/* 3rd Place */}
      {thirdPlace && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "120px" }}>
          <AchievementBadge type="championship" tier="bronze" label={thirdPlace.name} subtext={`${thirdPlace.score} pts`} size="md" />
          <div style={{ width: "100%", height: "80px", backgroundColor: "#EFEBE9", borderRadius: "8px 8px 0 0", borderTop: "4px solid #D7CCC8", display: "flex", justifyContent: "center", paddingTop: "16px", fontWeight: 800, color: "#8D6E63", fontSize: "2rem" }}>
            3
          </div>
        </div>
      )}
      
    </div>
  );
}


"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  getLeaderboard,
  listCompetitionTeams,
  createTeam,
  finalizeLeaderboard,
} from "@/lib/api/competition";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapUser } from "@/lib/auth";
import LeaderboardPodium from "@/components/achievements/LeaderboardPodium";

export default function CompetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const [teams, setTeams] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  
  const [institutionId, setInstitutionId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);

  const refresh = useCallback(async () => {
    const [t, l] = await Promise.all([
      listCompetitionTeams(params.id),
      getLeaderboard(params.id),
    ]);
    setTeams(t);
    setLeaderboard(l);

    // Resolve USER entity names from student_profiles
    const userIds = l.filter((r: any) => r.entity_type === 'USER').map((r: any) => r.entity_id);
    if (userIds.length > 0) {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.from('student_profiles').select('id, user_id, auth_users!student_profiles_user_id_fkey(raw_user_meta_data)').in('id', userIds);
      if (data) {
        const namesMap: Record<string, string> = {};
        data.forEach((stu: any) => {
          const meta = stu.auth_users?.raw_user_meta_data || {};
          namesMap[stu.id] = meta.full_name || meta.name || 'Anonymous Student';
        });
        setStudentNames(namesMap);
      }
    }
  }, [params.id]);

  useEffect(() => {
    async function load() {
      try {
        const userCtx = await bootstrapUser();
        setCurrentUserProfile(userCtx.studentProfile || userCtx.teacherProfile || { id: userCtx.userId });
        
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("institutions")
          .select("*")
          .order("name");
        if (error) throw error;
        setInstitutions(data ?? []);
        await refresh();
      } catch (e: any) {
        setError(e.message);
      }
    }

    load();
  }, [refresh]);

  async function submitTeam(e: FormEvent) {
    e.preventDefault();
    try {
      await createTeam(params.id, institutionId, teamName);
      setTeamName("");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Helper to resolve entity ID to human readable name
  const resolveEntityName = (type: string, id: string) => {
    if (type === 'TEAM') {
      const team = teams.find(t => t.id === id);
      return team ? team.team_name : 'Unknown Team';
    }
    if (type === 'SCHOOL' || type === 'INSTITUTION') {
      const inst = institutions.find(i => i.id === id);
      return inst ? (inst.name || inst.school_name) : 'Unknown School';
    }
    if (type === 'USER') {
      return studentNames[id] || 'Loading...';
    }
    return id; // fallback but we try to avoid UUIDs
  };
  
  // Helper to get subtitle (like School or Country) if applicable
  const resolveEntitySubtitle = (type: string, id: string) => {
    if (type === 'TEAM') {
      const team = teams.find(t => t.id === id);
      return team?.institutions?.name || 'Independent';
    }
    return undefined;
  };

  // Extract Top 3 for Podium
  const top3 = leaderboard.slice(0, 3).map((row, idx) => ({
    id: row.entity_id,
    rank: row.rank ?? idx + 1,
    name: resolveEntityName(row.entity_type, row.entity_id),
    score: row.score,
    subtitle: resolveEntitySubtitle(row.entity_type, row.entity_id),
    isCurrentUser: row.entity_id === currentUserProfile?.id
  }));

  const remainingLeaderboard = leaderboard.slice(3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div className="qb-page-head">
        <div>
          <h1>Competition Workspace</h1>
          <p>Live rankings and team management.</p>
        </div>
        <button
          className="qb-btn secondary"
          onClick={async () => {
            try {
              await finalizeLeaderboard(params.id);
              await refresh();
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          Finalize leaderboard
        </button>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      {/* Podium for Top 3 */}
      {top3.length > 0 && (
        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px", backgroundColor: "var(--qb-surface-muted)" }}>
          <h2 style={{ textAlign: "center", marginBottom: "16px" }}>Top Participants</h2>
          <LeaderboardPodium firstPlace={top3[0]} secondPlace={top3[1]} thirdPlace={top3[2]} />
        </section>
      )}

      <div className="qb-grid cols-2">
        <form className="qb-card qb-form" onSubmit={submitTeam}>
          <h2>Create team</h2>

          <div className="qb-field">
            <label htmlFor="team-institution">Institution</label>
            <select
              id="team-institution"
              value={institutionId}
              onChange={(e) => setInstitutionId(e.target.value)}
              required
            >
              <option value="">Select institution</option>
              {institutions.map((i) => (
                <option value={i.id} key={i.id}>
                  {i.name ?? i.school_name ?? i.id}
                </option>
              ))}
            </select>
          </div>

          <div className="qb-field">
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
            />
          </div>

          <button className="qb-btn" type="submit">
            Create team
          </button>
        </form>

        <div className="qb-card">
          <h2>Teams</h2>
          <div className="qb-list">
            {teams.map((team) => (
              <div className="qb-row" key={team.id}>
                <div className="qb-row-main">
                  <strong>{team.team_name}</strong>
                  <span>
                    {team.institutions?.name ?? team.team_code ?? ""}
                  </span>
                </div>
              </div>
            ))}
            {!teams.length && <div className="qb-muted">No teams created.</div>}
          </div>
        </div>
      </div>

      {remainingLeaderboard.length > 0 && (
        <section className="qb-card">
          <h2>Runners Up</h2>
          <div className="qb-list">
            {remainingLeaderboard.map((row, index) => {
              const name = resolveEntityName(row.entity_type, row.entity_id);
              const subtitle = resolveEntitySubtitle(row.entity_type, row.entity_id);
              const isMe = row.entity_id === currentUserProfile?.id;
              
              return (
                <div className="qb-row" key={`${row.entity_type}-${row.entity_id}`} style={{ backgroundColor: isMe ? "var(--qb-primary-light)" : undefined, borderColor: isMe ? "var(--qb-primary)" : undefined }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--qb-text-secondary)", width: "30px", textAlign: "center" }}>
                      {row.rank ?? index + 4}
                    </div>
                    <div className="qb-row-main">
                      <strong style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {name}
                        {isMe && <span className="qb-pill" style={{ backgroundColor: "var(--qb-primary)", color: "var(--qb-surface)" }}>You</span>}
                      </strong>
                      <span className="qb-muted">{row.entity_type}{subtitle ? ` · ${subtitle}` : ''}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{row.score} pts</div>
                    {row.percentage && <div className="qb-muted" style={{ fontSize: "0.875rem" }}>{row.percentage}% Accuracy</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

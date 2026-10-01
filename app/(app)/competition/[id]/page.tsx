"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  getLeaderboard,
  listCompetitionTeams,
  createTeam,
  finalizeLeaderboard,
} from "@/lib/api/competition";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function CompetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const [teams, setTeams] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [institutionId, setInstitutionId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [t, l] = await Promise.all([
      listCompetitionTeams(params.id),
      getLeaderboard(params.id),
    ]);
    setTeams(t);
    setLeaderboard(l);
  }

  useEffect(() => {
    async function load() {
      try {
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
  }, [params.id]);

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

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Competition Workspace</h1>
          <p>Teams and final leaderboard.</p>
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

      <div className="qb-grid cols-2">
        <form className="qb-card qb-form" onSubmit={submitTeam}>
          <h2>Create team</h2>

          <div className="qb-field">
            <label>Institution</label>
            <select
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
            <label>Team name</label>
            <input
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
          </div>
        </div>
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-card qb-table-wrap">
        <h2>Leaderboard</h2>
        <table className="qb-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Type</th>
              <th>Entity</th>
              <th>Score</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((row, index) => (
              <tr key={`${row.entity_type}-${row.entity_id}`}>
                <td>{row.rank ?? index + 1}</td>
                <td>{row.entity_type}</td>
                <td>{row.entity_id}</td>
                <td>{row.score}</td>
                <td>{row.percentage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

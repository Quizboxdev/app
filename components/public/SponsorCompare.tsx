// The usual way of giving compared with a QuizBox challenge. Every line describes something the platform does; none states a result or a figure.
export const SPONSOR_COMPARE = [
  ["Books and materials to ship, store and hand out", "Delivered digitally to learners on a phone, tablet or computer"],
  ["Little way to know whether materials are used", "Participation, completion and scores tracked for your challenge"],
  ["Results are hard to see", "Results by question and, where applicable, a leaderboard"],
  ["You run the logistics yourself", "QuizBox runs the platform; you set the audience and the recognition"],
] as const;

export default function SponsorCompare() {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="qbp-compare">
        <thead><tr><th scope="col">Giving the usual way</th><th scope="col">A QuizBox challenge</th></tr></thead>
        <tbody>{SPONSOR_COMPARE.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

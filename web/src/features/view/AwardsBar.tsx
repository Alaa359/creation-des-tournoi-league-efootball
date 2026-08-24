import type { StandingRow } from '../../shared/api';
import { Card, PlayerAvatar } from '../../ui/primitives';

interface Award {
  icon: string;
  title: string;
  stat: string;
  row: StandingRow;
  cls: string;
}

/** Récompenses individuelles calculées depuis le classement. */
function computeAwards(rows: StandingRow[]): Award[] {
  const active = rows.filter((r) => r.played > 0);
  if (active.length === 0) return [];
  const byScored = [...active].sort((a, b) => b.goalsFor - a.goalsFor);
  const byConcededAsc = [...active].sort((a, b) => a.goalsAgainst - b.goalsAgainst);
  const byConcededDesc = [...active].sort((a, b) => b.goalsAgainst - a.goalsAgainst);

  const awards: Award[] = [];
  if (byScored[0].goalsFor > 0) {
    awards.push({
      icon: '⚽',
      title: 'Buteur de la ligue',
      stat: `${byScored[0].goalsFor} but${byScored[0].goalsFor > 1 ? 's' : ''} marqué${byScored[0].goalsFor > 1 ? 's' : ''}`,
      row: byScored[0],
      cls: 'border-amber-300/30 bg-amber-300/5',
    });
  }
  awards.push({
    icon: '🛡️',
    title: 'Min. buts encaissés',
    stat: `${byConcededAsc[0].goalsAgainst} but${byConcededAsc[0].goalsAgainst > 1 ? 's' : ''} encaissé${byConcededAsc[0].goalsAgainst > 1 ? 's' : ''}`,
    row: byConcededAsc[0],
    cls: 'border-sky-400/30 bg-sky-400/5',
  });
  awards.push({
    icon: '🥅',
    title: 'Max. buts encaissés',
    stat: `${byConcededDesc[0].goalsAgainst} but${byConcededDesc[0].goalsAgainst > 1 ? 's' : ''} encaissé${byConcededDesc[0].goalsAgainst > 1 ? 's' : ''}`,
    row: byConcededDesc[0],
    cls: 'border-rose-400/30 bg-rose-400/5',
  });
  return awards;
}

export function AwardsBar({ rows }: { rows: StandingRow[] }) {
  const awards = computeAwards(rows);
  if (awards.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {awards.map((a) => (
        <Card key={a.title} className={`flex items-center gap-3 p-4 ${a.cls}`}>
          <span className="text-2xl">{a.icon}</span>
          <span className="flex min-w-0 items-center gap-2">
            <PlayerAvatar name={a.row.name} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-white">{a.row.name}</span>
              <span className="block truncate text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                {a.title} · {a.stat}
              </span>
            </span>
          </span>
        </Card>
      ))}
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { Tournament } from '../../shared/api';
import { Card, PlayerAvatar } from '../../ui/primitives';

interface PlayerStat {
  playerId: string;
  name: string;
  scored: number;
  conceded: number;
  played: number;
}

type AwardKind = 'scored' | 'conceded';

const plural = (n: number) => (n > 1 ? 's' : '');

/** Stats buts marqués / encaissés par joueur, calculées depuis TOUS les matchs
 *  (championnat, éliminations directes et formats hybrides). */
function computeStats(tournament: Tournament): PlayerStat[] {
  const byId = new Map<string, PlayerStat>();
  for (const p of tournament.players) {
    byId.set(p.id, { playerId: p.id, name: p.name, scored: 0, conceded: 0, played: 0 });
  }
  for (const m of tournament.matches) {
    if (m.homeScore == null || m.awayScore == null || !m.homeId || !m.awayId) continue;
    const home = byId.get(m.homeId);
    const away = byId.get(m.awayId);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.scored += m.homeScore;
    home.conceded += m.awayScore;
    away.scored += m.awayScore;
    away.conceded += m.homeScore;
  }
  return [...byId.values()];
}

/** Liste triée du plus grand au plus petit pour l'affichage détaillé. */
function sortList(stats: PlayerStat[], kind: AwardKind): PlayerStat[] {
  const eligible = stats.filter((s) => s.played > 0);
  if (kind === 'scored') {
    return [...eligible].sort((a, b) => b.scored - a.scored || a.name.localeCompare(b.name));
  }
  // But annulé : meilleure défense d'abord (moins de buts encaissés).
  return [...eligible].sort((a, b) => a.conceded - b.conceded || a.name.localeCompare(b.name));
}

export function AwardsBar({ tournament }: { tournament: Tournament }) {
  const stats = useMemo(() => computeStats(tournament), [tournament]);
  const [open, setOpen] = useState<AwardKind | null>(null);

  const scoringList = sortList(stats, 'scored');
  const defenseList = sortList(stats, 'conceded');
  if (scoringList.length === 0) return null;

  const topScorer = scoringList[0];
  const bestDefense = defenseList[0];

  const toggle = (kind: AwardKind) => setOpen((cur) => (cur === kind ? null : kind));

  const cards: {
    key: AwardKind;
    icon: string;
    title: string;
    stat: string;
    row: PlayerStat;
    cls: string;
    list: PlayerStat[];
    value: (s: PlayerStat) => string;
  }[] = [
    ...(topScorer.scored > 0
      ? [
          {
            key: 'scored' as const,
            icon: '⚽',
            title: 'But marqué',
            stat: `${topScorer.scored} but${plural(topScorer.scored)} marqué${plural(topScorer.scored)}`,
            row: topScorer,
            cls: 'border-amber-300/30 bg-amber-300/5',
            list: scoringList,
            value: (s: PlayerStat) => `${s.scored} but${plural(s.scored)}`,
          },
        ]
      : []),
    {
      key: 'conceded',
      icon: '🧤',
      title: 'But annulé',
      stat: `${bestDefense.conceded} but${plural(bestDefense.conceded)} encaissé${plural(bestDefense.conceded)}`,
      row: bestDefense,
      cls: 'border-sky-400/30 bg-sky-400/5',
      list: defenseList,
      value: (s: PlayerStat) => `${s.conceded} but${plural(s.conceded)} encaissé${plural(s.conceded)}`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((a) => (
          <Card
            key={a.key}
            className={`flex cursor-pointer select-none items-center gap-3 p-4 transition hover:brightness-110 ${a.cls} ${
              open === a.key ? 'ring-1 ring-white/25' : ''
            }`}
          >
            <button type="button" onClick={() => toggle(a.key)} aria-expanded={open === a.key} className="flex w-full items-center gap-3 text-left">
              <span className="text-2xl">{a.icon}</span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <PlayerAvatar name={a.row.name} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{a.row.name}</span>
                  <span className="block truncate text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                    {a.title} · {a.stat}
                  </span>
                </span>
              </span>
              <span className={`text-xs text-slate-400 transition-transform ${open === a.key ? 'rotate-180' : ''}`}>▼</span>
            </button>
          </Card>
        ))}
      </div>

      {cards.map(
        (a) =>
          open === a.key && (
            <Card key={`${a.key}-list`} className="overflow-hidden">
              <h4 className="font-display border-b border-white/10 px-3 py-2.5 text-sm tracking-widest text-slate-300 uppercase">
                {a.icon} {a.title} — classement des joueurs
              </h4>
              <ul>
                {a.list.map((s, i) => (
                  <li
                    key={s.playerId}
                    className={`flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0 ${
                      i === 0 ? 'bg-amber-300/[0.07]' : ''
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                        i === 0
                          ? 'bg-amber-300 text-amber-950'
                          : i === 1
                            ? 'bg-slate-300/80 text-slate-900'
                            : i === 2
                              ? 'bg-orange-700/60 text-orange-100'
                              : 'text-slate-500'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <PlayerAvatar name={s.name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">{s.name}</span>
                    <span
                      className={`text-sm font-semibold ${
                        a.key === 'scored' ? 'text-amber-300' : 'text-sky-300'
                      }`}
                    >
                      {a.value(s)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ),
      )}
    </div>
  );
}

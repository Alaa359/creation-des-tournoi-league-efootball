import { useMemo } from 'react';
import type { Match, Tournament } from '../../shared/api';
import { knockoutMatches, roundRobinMatches } from '../../shared/tournament';
import { Card, FadeIn, PlayerAvatar, getRoundLabel } from '../../ui/primitives';

function nameOf(t: Tournament, id: string | null): string | null {
  return t.players.find((p) => p.id === id)?.name ?? null;
}

interface MatchRowProps {
  t: Tournament;
  m: Match;
  ko?: boolean;
}

function MatchRow({ t, m, ko }: MatchRowProps) {
  const homeName = nameOf(t, m.homeId);
  const awayName = nameOf(t, m.awayId);
  const played = m.homeScore !== undefined && m.awayScore !== undefined;
  const isPens = m.homePens !== undefined && m.awayPens !== undefined;

  if (!homeName || !awayName) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="min-w-0 break-words">{homeName ?? '—'}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500 italic">
          {m.autoAdvance ? "qualifié d'office" : 'en attente…'}
        </span>
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="min-w-0 break-words">{awayName ?? '—'}</span>
        </span>
      </div>
    );
  }

  const homeWins = played && (m.homeScore! > m.awayScore! || (isPens && m.homePens! > m.awayPens!));
  const awayWins = played && (m.awayScore! > m.homeScore! || (isPens && m.awayPens! > m.homePens!));

  return (
    <div
      className={`grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2.5 text-sm transition ${
        played
          ? 'border-white/10 bg-white/[0.04]'
          : 'border-white/5 bg-black/20'
      }`}
    >
      {/* Home */}
      <span className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span
          className={`min-w-0 break-words font-bold ${homeWins ? 'text-lime-300' : awayWins ? 'text-slate-400' : 'text-slate-200'}`}
        >
          {homeName}
        </span>
        <PlayerAvatar name={homeName} />
      </span>

      {/* Score */}
      {played ? (
        <span className="flex shrink-0 items-center gap-1 rounded-lg bg-black/40 px-2.5 py-1 font-extrabold tabular-nums">
          <span className={homeWins ? 'text-lime-300' : 'text-slate-200'}>{m.homeScore}</span>
          <span className="text-slate-500">–</span>
          <span className={awayWins ? 'text-lime-300' : 'text-slate-200'}>{m.awayScore}</span>
        </span>
      ) : (
        <span className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-500 uppercase">
          À venir
        </span>
      )}

      {/* Away */}
      <span className="flex min-w-0 items-center gap-2">
        <PlayerAvatar name={awayName} />
        <span
          className={`min-w-0 break-words font-bold ${awayWins ? 'text-lime-300' : homeWins ? 'text-slate-400' : 'text-slate-200'}`}
        >
          {awayName}
        </span>
      </span>

      {/* Pens badge */}
      {isPens && (
        <span className="shrink-0 text-[10px] font-bold text-amber-300 uppercase">
          tab {m.homePens}–{m.awayPens}
        </span>
      )}
    </div>
  );
}

interface RoundGroup {
  round: number;
  label: string;
  matches: Match[];
}

function useMatchGroups(tournament: Tournament) {
  return useMemo(() => {
    const rr = roundRobinMatches(tournament);
    const ko = knockoutMatches(tournament);

    const groups: { title: string; rounds: RoundGroup[] }[] = [];

    // Round-robin matches (league / group phases)
    if (rr.length > 0) {
      const maxRound = Math.max(...rr.map((m) => m.round));
      const rounds: RoundGroup[] = Array.from({ length: maxRound }, (_, r) => ({
        round: r + 1,
        label: `Journée ${r + 1}`,
        matches: rr.filter((m) => m.round === r + 1),
      }));
      groups.push({ title: 'Championnat', rounds });
    }

    // Knockout matches
    if (ko.length > 0) {
      const maxRound = Math.max(...ko.map((m) => m.round));
      const rounds: RoundGroup[] = Array.from({ length: maxRound }, (_, r) => ({
        round: r + 1,
        label: getRoundLabel(r + 1, maxRound),
        matches: ko.filter((m) => m.round === r + 1),
      })).reverse();
      groups.push({ title: 'Éliminations directes', rounds });
    }

    return groups;
  }, [tournament]);
}

export function MatchList({ tournament }: { tournament: Tournament }) {
  const groups = useMatchGroups(tournament);

  if (groups.length === 0) return null;

  const totalPlayed = tournament.matches.filter(
    (m) => m.homeScore !== undefined && m.awayScore !== undefined,
  ).length;
  const totalUpcoming = tournament.matches.filter(
    (m) => m.homeScore === undefined && m.homeId !== null && m.awayId !== null && !m.autoAdvance,
  ).length;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl tracking-wide text-slate-200">Calendrier</h2>
        <span className="text-xs text-slate-500">
          {totalPlayed} joué{totalPlayed > 1 ? 's' : ''} · {totalUpcoming} à venir
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.title} className="space-y-4">
          {group.rounds.map((round) => {
            const played = round.matches.filter((m) => m.homeScore !== undefined);
            const upcoming = round.matches.filter((m) => m.homeScore === undefined);

            return (
              <FadeIn key={`${group.title}-${round.round}`}>
                <Card className="p-4">
                  <h3
                    className={`mb-3 text-xs font-extrabold tracking-widest uppercase ${
                      group.title === 'Éliminations directes' ? 'text-fuchsia-300' : 'text-lime-300'
                    }`}
                  >
                    {round.label}
                  </h3>
                  <div className="space-y-2">
                    {played.map((m) => (
                      <MatchRow key={m.id} t={tournament} m={m} ko={group.title === 'Éliminations directes'} />
                    ))}
                    {upcoming.map((m) => (
                      <MatchRow key={m.id} t={tournament} m={m} ko={group.title === 'Éliminations directes'} />
                    ))}
                  </div>
                </Card>
              </FadeIn>
            );
          })}
        </div>
      ))}
    </section>
  );
}

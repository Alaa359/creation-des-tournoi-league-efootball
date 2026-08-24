import { motion } from 'motion/react';
import type { Match, Player, Tournament } from '../../shared/api';
import { knockoutMatches } from '../../shared/tournament';
import { Card, FadeIn, PlayerAvatar, JerseyIcon, getRoundLabel } from '../../ui/primitives';
import { Confetti, useTimedFlag } from '../../ui/fx';

function Side({
  name,
  score,
  pens,
  legScores,
  isWinner,
  decided,
}: {
  name: string | null;
  score?: number;
  pens?: number;
  legScores?: (number | undefined)[];
  isWinner: boolean;
  decided: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
        !name ? 'text-slate-600 italic' : decided && !isWinner ? 'text-slate-500' : ''
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {name ? (
          <>
            <PlayerAvatar name={name} />
            <span className={`truncate text-sm ${isWinner && decided ? 'font-extrabold text-lime-300' : 'font-semibold'}`}>
              {name}
            </span>
          </>
        ) : (
          <span className="text-sm">En attente…</span>
        )}
      </span>
      <span className="flex items-baseline gap-1">
        {legScores && (
          <span className="text-[10px] font-bold text-slate-400">
            ({legScores.map((s, i) => `${i > 0 ? '·' : ''}${s ?? '–'}`).join('')})
          </span>
        )}
        {pens !== undefined && name && (
          <span className="text-[10px] font-bold text-amber-300">({pens})</span>
        )}
        <span className={`min-w-5 text-center text-base font-extrabold ${isWinner && decided ? 'text-lime-300' : ''}`}>
          {name && score !== undefined ? score : '–'}
        </span>
      </span>
    </div>
  );
}

function winnerOfMatch(match: Match): string | null {
  if (match.autoAdvance) return match.homeId ?? match.awayId ?? null;
  if (
    match.homeScore === undefined ||
    match.awayScore === undefined ||
    !match.homeId ||
    !match.awayId
  ) {
    return null;
  }
  if (match.homeScore !== match.awayScore) {
    return match.homeScore > match.awayScore ? match.homeId : match.awayId;
  }
  if ((match.homePens ?? -1) > (match.awayPens ?? -1)) return match.homeId;
  if ((match.awayPens ?? 0) > (match.homePens ?? 0)) return match.awayId;
  return null;
}

function MatchCard({ match, players }: { match: Match; players: Map<string, Player> }) {
  const home = match.homeId ? players.get(match.homeId) : undefined;
  const away = match.awayId ? players.get(match.awayId) : undefined;
  const played = match.homeScore !== undefined;
  const winnerId = played || match.autoAdvance ? winnerOfMatch(match) : null;

  if (!home && !away) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="rounded-xl border border-white/10 bg-black/30 p-2 shadow-lg shadow-black/20"
    >
      <Side
        name={home?.name ?? null}
        score={match.homeScore}
        pens={match.homePens}
        isWinner={winnerId === match.homeId}
        decided={played || match.autoAdvance === true}
      />
      <div className="my-0.5 h-px bg-white/5" />
      <Side
        name={away?.name ?? null}
        score={match.awayScore}
        pens={match.awayPens}
        isWinner={winnerId === match.awayId}
        decided={played || match.autoAdvance === true}
      />
    </motion.div>
  );
}

interface TieView {
  key: string;
  round: number;
  legs: Match[];
}

function TieCard({ tie, players }: { tie: TieView; players: Map<string, Player> }) {
  if (tie.legs.length <= 1) return <MatchCard match={tie.legs[0]} players={players} />;

  const [leg1, leg2] = tie.legs;
  const home = leg1.homeId ? players.get(leg1.homeId) : undefined;
  const away = leg1.awayId ? players.get(leg1.awayId) : undefined;
  if (!home || !away) return null;

  const played = tie.legs.every((l) => l.homeScore !== undefined);
  const agg = new Map<string, number>();
  for (const l of tie.legs) {
    if (l.homeScore === undefined || l.awayScore === undefined) continue;
    if (l.homeId) agg.set(l.homeId, (agg.get(l.homeId) ?? 0) + l.homeScore);
    if (l.awayId) agg.set(l.awayId, (agg.get(l.awayId) ?? 0) + l.awayScore);
  }
  const hAgg = agg.get(home.id) ?? 0;
  const aAgg = agg.get(away.id) ?? 0;

  let winnerId: string | null = null;
  if (played && hAgg !== aAgg) winnerId = hAgg > aAgg ? home.id : away.id;

  const decider = [...tie.legs].reverse().find(
    (l) => l.homePens !== undefined && l.awayPens !== undefined,
  );
  const hPens =
    decider && (decider.homeId === home.id ? decider.homePens : decider.awayPens);
  const aPens =
    decider && (decider.awayId === away.id ? decider.awayPens : decider.homePens);
  if (played && hAgg === aAgg && hPens !== undefined && aPens !== undefined && hPens !== aPens) {
    winnerId = hPens > aPens ? home.id : away.id;
  }

  const legScoreOf = (pid: string, l: Match): number | undefined =>
    l.homeId === pid ? l.homeScore : l.awayScore;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`rounded-xl border bg-black/30 p-2 shadow-lg shadow-black/20 ${
        winnerId ? 'border-lime-400/30' : 'border-white/10'
      }`}
    >
      <div className="mb-1 flex items-center justify-center gap-1 text-[9px] font-extrabold tracking-widest text-slate-500 uppercase">
        <JerseyIcon className="h-3 w-3" /> Aller-retour · agrégat {played ? `${hAgg}–${aAgg}` : '—'}
      </div>
      <Side
        name={home.name}
        score={played ? hAgg : undefined}
        pens={hPens}
        legScores={[legScoreOf(home.id, leg1), legScoreOf(home.id, leg2)]}
        isWinner={winnerId === home.id}
        decided={played}
      />
      <div className="my-0.5 h-px bg-white/5" />
      <Side
        name={away.name}
        score={played ? aAgg : undefined}
        pens={aPens}
        legScores={[legScoreOf(away.id, leg1), legScoreOf(away.id, leg2)]}
        isWinner={winnerId === away.id}
        decided={played}
      />
    </motion.div>
  );
}

export function BracketTree({ tournament }: { tournament: Tournament }) {
  const koMatches = knockoutMatches(tournament);
  const totalRounds = Math.max(...koMatches.map((m) => m.round), 0);
  const isDouble = koMatches.some((m) => m.tieKey != null);

  const columns: TieView[][] = Array.from({ length: totalRounds }, (_, r) => {
    const roundMatches = koMatches.filter((m) => m.round === r + 1);
    const ties: TieView[] = [];
    if (isDouble) {
      for (const m of roundMatches) {
        let tie = ties.find((t) => t.key === (m.tieKey ?? m.id));
        if (!tie) {
          tie = { key: m.tieKey ?? m.id, round: m.round, legs: [] };
          ties.push(tie);
        }
        tie.legs.push(m);
      }
      for (const tie of ties) tie.legs.sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
    } else {
      for (const m of roundMatches) ties.push({ key: m.id, round: m.round, legs: [m] });
    }
    return ties.filter((tie) => tie.legs.some((m) => m.homeId || m.awayId));
  }).reverse();

  const players = new Map(tournament.players.map((p) => [p.id, p]));
  const champion = tournament.championId ? players.get(tournament.championId) : undefined;
  const celebrate = useTimedFlag(Boolean(champion), 6000);

  return (
    <div>
      <Confetti active={celebrate} />
      <div className="overflow-x-auto pb-4">
        <div className="flex min-w-max items-stretch gap-8">
          {columns.map((ties, colIdx) => (
            <FadeIn key={ties[0]?.round ?? colIdx} delay={colIdx * 0.08} className="flex flex-col">
              <h3 className="mb-3 text-center text-xs font-extrabold tracking-widest text-slate-400 uppercase">
                {getRoundLabel(ties[0]?.round ?? colIdx + 1, totalRounds)}
              </h3>
              <div
                className="flex flex-1 flex-col justify-around border-r border-white/5 pr-8"
                style={{ rowGap: `${Math.min(colIdx * 24 + 12, 120)}px` }}
              >
                {ties.map((tie) => (
                  <TieCard key={tie.key} tie={tie} players={players} />
                ))}
              </div>
            </FadeIn>
          ))}
          <div className="flex flex-col">
            <div className="mb-3 flex items-center justify-center gap-2">
              <motion.img
                src="/logos/worldcup.svg"
                alt="Coupe du Monde"
                title="Coupe du Monde"
                className="h-9 w-auto drop-shadow-[0_2px_14px_rgba(251,191,36,0.5)]"
                animate={{ y: [-2, 2, -2] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <h3 className="text-center text-xs font-extrabold tracking-widest text-amber-300/80 uppercase">
                Champion
              </h3>
            </div>
            <div className="flex flex-1 items-center">
              {champion ? (
                <Card className="border-amber-300/40 bg-amber-300/10 p-5 text-center">
                  <img
                    src="/logos/trophy-cup.svg"
                    alt=""
                    aria-hidden
                    className="mx-auto h-20 w-auto drop-shadow-[0_4px_16px_rgba(251,191,36,0.45)]"
                  />
                  <p className="font-display mt-1 text-3xl tracking-wide text-amber-200">
                    {champion.name}
                  </p>
                  <p className="mt-1 text-xs font-bold tracking-widest text-amber-300/70 uppercase">
                    Vainqueur du tournoi
                  </p>
                </Card>
              ) : (
                <Card className="p-5 text-center text-slate-500 italic">Trophée à remporter…</Card>
              )}
              {champion && (
                <motion.img
                  src="/logos/trophy-cup.svg"
                  alt="Coupe du vainqueur"
                  title="Coupe du vainqueur"
                  className="-ml-1 h-44 w-auto self-start drop-shadow-[0_8px_28px_rgba(251,191,36,0.6)] sm:h-56"
                  initial={{ opacity: 0, scale: 0.4, rotate: -18 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0, y: [0, -9, 0] }}
                  transition={{
                    opacity: { duration: 0.5 },
                    scale: { type: 'spring', stiffness: 180, damping: 12 },
                    rotate: { duration: 0.5 },
                    y: { duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 },
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

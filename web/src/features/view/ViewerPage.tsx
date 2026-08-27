import { Link, useParams } from 'react-router';
import { useLiveTournament } from '../../shared/live';
import { knockoutMatches } from '../../shared/tournament';
import { FadeIn, TypeBadge } from '../../ui/primitives';
import { BallLoader } from '../../ui/fx';
import { Card } from '../../ui/primitives';
import { StandingsTable } from './StandingsTable';
import { BracketTree } from './BracketTree';
import { AwardsBar } from './AwardsBar';
import { MatchList } from './MatchList';

function daysRemaining(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const { tournament, error, live } = useLiveTournament(id);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <Card className="p-8 text-center text-red-300">{error}</Card>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="py-24">
        <BallLoader />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-wide sm:text-4xl">{tournament.name}</h1>
            <div className="mt-1.5 flex items-center gap-2">
              <TypeBadge type={tournament.type} />
              <span className="text-xs text-slate-500">
                👥 {tournament.players.length} joueurs
              </span>
              {(() => {
                const days = daysRemaining((tournament as any).expiresAt);
                if (days === null) return null;
                if (days === 0) return <span className="text-xs font-bold text-red-400">⚠ Expire aujourd'hui</span>;
                if (days <= 3) return <span className="text-xs font-bold text-amber-400">⏱ {days}j restant{days > 1 ? 's' : ''}</span>;
                return null;
              })()}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${
                live ? 'bg-lime-400/15 text-lime-300' : 'bg-white/5 text-slate-400'
              }`}
              title="Mise à jour automatique en temps réel"
            >
              <span
                className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-lime-400' : 'bg-slate-500'}`}
              />
              {live ? 'EN DIRECT' : 'HORS LIGNE'}
            </span>
            <Link to={`/t/${tournament.id}/admin`} className="btn-ghost">
              ⚙ Espace organisateur
            </Link>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.1} className="mt-6 space-y-6">
        {(() => {
          const ko = knockoutMatches(tournament);
          const showTable =
            (tournament.type === 'league' || tournament.type === 'league-knockout') &&
            tournament.standings;
          const isPlayoff = tournament.type === 'playoff';
          return (
            <>
              {showTable && <StandingsTable rows={tournament.standings!} />}
              {(tournament.type === 'groups-knockout' || isPlayoff) && !!tournament.groupStandings?.length && (
                <section>
                  {isPlayoff && (
                    <h2 className="font-display mb-3 text-2xl tracking-wide text-slate-200">
                      Phase de groupes
                    </h2>
                  )}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {tournament.groupStandings.map((rows, i) => (
                      <StandingsTable key={i} rows={rows} title={`Groupe ${String.fromCharCode(65 + i)}`} />
                    ))}
                  </div>
                </section>
              )}
              {isPlayoff && tournament.playoffStandings && tournament.playoffStandings.length > 0 && (
                <section>
                  <h2 className="font-display mb-3 text-2xl tracking-wide text-emerald-300">
                    Playoff
                  </h2>
                  <StandingsTable rows={tournament.playoffStandings} showBonus />
                </section>
              )}
              <AwardsBar tournament={tournament} />
              <MatchList tournament={tournament} />
              {(ko.length > 0 || tournament.championId) && (
                <section>
                  {showTable && (
                    <h2 className="font-display mb-3 text-2xl tracking-wide text-slate-200">
                      Éliminations directes
                    </h2>
                  )}
                  <BracketTree tournament={tournament} />
                </section>
              )}
            </>
          );
        })()}
      </FadeIn>

      <p className="mt-6 text-center text-xs text-slate-600">
        Partagez l'adresse de cette page à vos amis : les résultats s'affichent en direct.
      </p>
    </div>
  );
}

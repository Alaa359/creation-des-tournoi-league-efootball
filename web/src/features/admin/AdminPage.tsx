import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Match, type Tournament } from '../../shared/api';
import { knockoutMatches, roundRobinMatches } from '../../shared/tournament';
import { useLiveTournament } from '../../shared/live';
import { Card, FadeIn, PlayerAvatar, TypeBadge, getRoundLabel } from '../../ui/primitives';

interface Draft {
  h: string;
  a: string;
  hp: string;
  ap: string;
}

function nameOf(t: Tournament, id: string | null): string | null {
  return t.players.find((p) => p.id === id)?.name ?? null;
}

function LegTag({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-lime-400/15 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-lime-300 uppercase">
      {label}
    </span>
  );
}

const LEG_LABELS = { 1: 'Aller', 2: 'Retour' } as const;

function MatchRow({ t, m, legLabel, ko }: { t: Tournament; m: Match; legLabel?: string; ko?: boolean }) {
  const [draft, setDraft] = useState<Draft>({ h: '', a: '', hp: '', ap: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const homeName = nameOf(t, m.homeId);
  const awayName = nameOf(t, m.awayId);
  const editable = Boolean(homeName && awayName) && !m.autoAdvance;
  const played = m.homeScore !== undefined;
  const isKnockout = Boolean(ko);
  const tie =
    isKnockout && draft.h !== '' && draft.a !== '' && Number(draft.h) === Number(draft.a);

  const valid =
    editable &&
    draft.h !== '' &&
    draft.a !== '' &&
    (!tie || (draft.hp !== '' && draft.ap !== '' && Number(draft.hp) !== Number(draft.ap)));

  if (!editable) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          {legLabel && <LegTag label={legLabel} />}
          {homeName ?? '—'}
        </span>
        <span className="text-xs text-slate-500 italic">
          {m.autoAdvance ? "qualifié d'office" : 'en attente…'}
        </span>
        <span className="flex items-center gap-2 font-semibold">{awayName ?? '—'}</span>
      </div>
    );
  }

  const save = (): void => {
    setBusy(true);
    setError(null);
    api
      .saveResult(t.id, m.id, {
        homeScore: Number(draft.h),
        awayScore: Number(draft.a),
        ...(tie ? { homePens: Number(draft.hp), awayPens: Number(draft.ap) } : {}),
      })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
        setDraft({ h: '', a: '', hp: '', ap: '' });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      {played && (
        <p className="mb-1.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
          {legLabel && <span className="mr-2 text-lime-300">{legLabel}</span>}
          Score actuel : {homeName} {m.homeScore} – {m.awayScore} {awayName}
          {m.homePens !== undefined ? ` (tab ${m.homePens}-${m.awayPens})` : ''}
        </p>
      )}
      {/* ── Mobile : un joueur par ligne, grandes cases faciles à remplir ── */}
      <div className="space-y-2 sm:hidden">
        {[
          { label: homeName, field: 'h' as const, aria: `Buts ${homeName}` },
          { label: awayName, field: 'a' as const, aria: `Buts ${awayName}` },
        ].map((row) => (
          <div key={row.field} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{row.label}</span>
            <input
              className="score-input !h-12 !w-16 !text-2xl"
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              placeholder="–"
              aria-label={row.aria}
              value={draft[row.field]}
              onChange={(e) => setDraft((d) => ({ ...d, [row.field]: e.target.value }))}
            />
          </div>
        ))}

        {tie && (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2">
            <span className="text-xs font-bold tracking-wider text-amber-300 uppercase">Tirs au but</span>
            <input
              className="score-input !h-10 !w-14 !text-xl"
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              placeholder="–"
              aria-label={`Tirs au but ${homeName}`}
              value={draft.hp}
              onChange={(e) => setDraft((d) => ({ ...d, hp: e.target.value }))}
            />
            <span className="font-bold text-slate-500">:</span>
            <input
              className="score-input !h-10 !w-14 !text-xl"
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              placeholder="–"
              aria-label={`Tirs au but ${awayName}`}
              value={draft.ap}
              onChange={(e) => setDraft((d) => ({ ...d, ap: e.target.value }))}
            />
          </div>
        )}

        <button
          type="button"
          className="btn-primary w-full py-3 text-base"
          disabled={!valid || busy}
          onClick={save}
        >
          {busy ? '…' : saved ? '✓ Enregistré' : played ? 'Corriger le score' : '✓ Valider le score'}
        </button>
      </div>

      {/* ── Desktop : disposition compacte sur une ligne ── */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <span className="min-w-24 flex-1 truncate text-right text-sm font-bold">{homeName}</span>
        <input
          className="score-input"
          type="number"
          min={0}
          max={99}
          placeholder="–"
          aria-label={`Buts ${homeName}`}
          value={draft.h}
          onChange={(e) => setDraft((d) => ({ ...d, h: e.target.value }))}
        />
        <span className="text-slate-500">:</span>
        <input
          className="score-input"
          type="number"
          min={0}
          max={99}
          placeholder="–"
          aria-label={`Buts ${awayName}`}
          value={draft.a}
          onChange={(e) => setDraft((d) => ({ ...d, a: e.target.value }))}
        />
        <span className="min-w-24 flex-1 truncate text-sm font-bold">{awayName}</span>

        {tie && (
          <>
            <span className="text-xs font-bold text-amber-300">TAB</span>
            <input
              className="score-input w-10"
              type="number"
              min={0}
              max={99}
              placeholder="–"
              aria-label={`Tirs au but ${homeName}`}
              value={draft.hp}
              onChange={(e) => setDraft((d) => ({ ...d, hp: e.target.value }))}
            />
            <input
              className="score-input w-10"
              type="number"
              min={0}
              max={99}
              placeholder="–"
              aria-label={`Tirs au but ${awayName}`}
              value={draft.ap}
              onChange={(e) => setDraft((d) => ({ ...d, ap: e.target.value }))}
            />
          </>
        )}

        <button
          type="button"
          className="btn-primary px-4 py-1.5 text-sm"
          disabled={!valid || busy}
          onClick={save}
        >
          {busy ? '…' : saved ? '✓ Enregistré' : played ? 'Corriger' : 'Valider'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-red-400">{error}</p>}
    </div>
  );
}

export function AdminPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tournament, error } = useLiveTournament(id);
  const [newPlayer, setNewPlayer] = useState('');
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rrGrouped = useMemo(() => {
    if (!tournament) return [];
    const rr = roundRobinMatches(tournament);
    if (rr.length === 0) return [];
    const maxRound = Math.max(...rr.map((m) => m.round));
    return Array.from({ length: maxRound }, (_, r) => ({
      round: r + 1,
      matches: rr.filter((m) => m.round === r + 1),
    }));
  }, [tournament]);

  const koGrouped = useMemo(() => {
    if (!tournament || tournament.matches.length === 0) return [];
    const ko = knockoutMatches(tournament);
    if (ko.length === 0) return [];
    const isDouble = ko.some((m) => m.tieKey != null);
    const maxRound = Math.max(...ko.map((m) => m.round));
    return Array.from({ length: maxRound }, (_, r) => {
      const roundMatches = ko.filter((m) => m.round === r + 1);
      const ties: { key: string; matches: Match[] }[] = [];
      if (isDouble) {
        for (const m of roundMatches) {
          let tie = ties.find((t) => t.key === (m.tieKey ?? m.id));
          if (!tie) {
            tie = { key: m.tieKey ?? m.id, matches: [] };
            ties.push(tie);
          }
          tie.matches.push(m);
        }
        for (const tie of ties) tie.matches.sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
      } else {
        for (const m of roundMatches) ties.push({ key: m.id, matches: [m] });
      }
      return { round: r + 1, title: getRoundLabel(r + 1, maxRound), ties };
    }).reverse();
  }, [tournament]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <Card className="p-8 text-center text-red-300">{error}</Card>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="py-24 text-center">
        <span className="h-8 w-8 inline-block animate-spin rounded-full border-2 border-lime-400/30 border-t-lime-400" />
      </div>
    );
  }

  const started = tournament.matches.some((m) => m.homeScore != null);
  const viewerUrl = `${window.location.origin}/t/${tournament.id}`;

  const handleDelete = (): void => {
    if (
      !window.confirm(
        `Supprimer définitivement « ${tournament.name} » ? Tous les scores seront perdus.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    api
      .deleteTournament(tournament.id)
      .then(() => navigate('/'))
      .catch((e: Error) => {
        setRosterError(e.message);
        setDeleting(false);
      });
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl tracking-wide">{tournament.name}</h1>
            <div className="mt-1.5 flex items-center gap-2">
              <TypeBadge type={tournament.type} />
              <Link
                to={`/t/${tournament.id}`}
                className="text-xs font-semibold text-lime-300 underline-offset-2 hover:underline"
              >
                Voir la page spectateur →
              </Link>
            </div>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.06}>
        <Card className="mt-5 flex flex-wrap items-center gap-3 p-4">
          <label className="text-xs font-extrabold tracking-widest text-slate-400 uppercase">
            Lien à partager
          </label>
          <input
            readOnly
            className="input flex-1 text-sm"
            value={viewerUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn-primary px-4 py-2 text-sm"
            onClick={() =>
              navigator.clipboard
                .writeText(viewerUrl)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                })
                .catch(() => undefined)
            }
          >
            {copied ? '✓ Copié !' : '📋 Copier'}
          </button>
        </Card>
      </FadeIn>

      <FadeIn delay={0.12}>
        <Card className="mt-5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {tournament.players.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/5 py-1 pr-2 pl-1 text-sm font-semibold"
              >
                <PlayerAvatar name={p.name} />
                {p.name}
                {!started && (
                  <button
                    type="button"
                    aria-label={`Retirer ${p.name}`}
                    className="ml-1 rounded-full px-1 text-red-400 hover:bg-red-500/15"
                    onClick={() =>
                      api
                        .removePlayer(tournament.id, p.id)
                        .catch((e: Error) => setRosterError(e.message))
                    }
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
          {!started && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newPlayer.trim()) return;
                api
                  .addPlayer(tournament.id, newPlayer.trim())
                  .then(() => setNewPlayer(''))
                  .catch((e: Error) => setRosterError(e.message));
              }}
            >
              <input
                className="input max-w-56"
                placeholder="Ajouter un joueur…"
                maxLength={30}
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
              />
              <button type="submit" className="btn-ghost" disabled={!newPlayer.trim()}>
                ＋ Ajouter
              </button>
              <span className="self-center text-xs text-slate-500">
                Possible tant qu'aucun score n'est saisi.
              </span>
            </form>
          )}
          {started && (
            <p className="mt-3 text-xs text-slate-500">
              Roster verrouillé après le premier score saisi.
            </p>
          )}
          {rosterError && <p className="mt-2 text-sm font-semibold text-red-400">{rosterError}</p>}
        </Card>
      </FadeIn>

      <FadeIn delay={0.18}>
        <h2 className="font-display mt-8 mb-3 text-2xl tracking-wide text-slate-200">
          Saisie des résultats
        </h2>
        {rrGrouped.length > 0 && (
          <div className="space-y-6">
            {rrGrouped.map((group) => (
              <Card key={group.round} className="space-y-3 p-4">
                <h3 className="text-xs font-extrabold tracking-widest text-lime-300 uppercase">
                  Journée {group.round}
                </h3>
                {group.matches.map((m) => (
                  <MatchRow key={m.id} t={tournament} m={m} />
                ))}
              </Card>
            ))}
          </div>
        )}
        {koGrouped.length > 0 && (
          <>
            {rrGrouped.length > 0 && (
              <h3 className="font-display mt-6 mb-3 text-xl tracking-wide text-fuchsia-300/90">
                Éliminations directes
              </h3>
            )}
            <div className="space-y-6">
              {koGrouped.map((group) => (
                <Card key={group.round} className="space-y-3 p-4">
                  <h4 className="text-xs font-extrabold tracking-widest text-fuchsia-300 uppercase">
                    {group.title}
                  </h4>
                  {group.ties.map((tie) =>
                    tie.matches.length > 1 ? (
                      <div
                        key={tie.key}
                        className="space-y-1.5 rounded-xl border border-white/10 bg-black/15 p-2"
                      >
                        {tie.matches.map((m) => (
                          <MatchRow
                            key={m.id}
                            t={tournament}
                            m={m}
                            legLabel={LEG_LABELS[m.leg ?? 1]}
                            ko
                          />
                        ))}
                      </div>
                    ) : (
                      <MatchRow key={tie.key} t={tournament} m={tie.matches[0]} ko />
                    ),
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
        {rrGrouped.length === 0 && koGrouped.length === 0 && (
          <Card className="p-6 text-center text-sm text-slate-400 italic">
            Aucun match à saisir pour le moment.
          </Card>
        )}
      </FadeIn>

      <FadeIn delay={0.24}>
        <Card className="mt-8 flex flex-wrap items-center justify-between gap-3 border-red-400/20 p-4">
          <div>
            <p className="text-sm font-bold text-red-300">Zone de danger</p>
            <p className="text-xs text-slate-500">
              Supprimer ce tournoi efface définitivement son calendrier et ses scores.
            </p>
          </div>
          <button
            type="button"
            className="btn-danger px-4 py-2 text-sm"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? 'Suppression…' : '🗑 Supprimer le tournoi'}
          </button>
        </Card>
      </FadeIn>
    </div>
  );
}

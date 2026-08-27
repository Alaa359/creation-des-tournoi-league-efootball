import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type TournamentType } from '../../shared/api';
import { Card, FadeIn, Spinner, TypeBadge } from '../../ui/primitives';

function bracketSize(n: number): number {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

const FORMATS: { value: TournamentType; logos: string[]; label: string; desc: string }[] = [
  {
    value: 'league',
    logos: ['/logos/league.svg'],
    label: 'League',
    desc: 'Championnat : chacun rencontre tous les autres.',
  },
  {
    value: 'knockout',
    logos: ['/logos/knockout.svg'],
    label: 'Knockout',
    desc: 'Coupe à élimination directe avec tirs au but.',
  },
  {
    value: 'league-knockout',
    logos: ['/logos/league.svg', '/logos/knockout.svg'],
    label: 'League + Knockout',
    desc: 'Championnat complet, puis éliminations entre les meilleurs.',
  },
  {
    value: 'groups-knockout',
    logos: ['/logos/group.png', '/logos/knockout.svg'],
    label: 'Groupes + Knockout',
    desc: 'Phase de groupes, puis éliminations entre les qualifiés.',
  },
  {
    value: 'playoff',
    logos: ['/logos/group.png', '/logos/league.svg'],
    label: 'Playoff',
    desc: 'Phase de groupes, puis tournoi entre les meilleurs (Ligue 1 Tunisie).',
  },
];

export function CreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState<TournamentType>('knockout');
  const [doubleRound, setDoubleRound] = useState(false);
  const [qualifiers, setQualifiers] = useState(4);
  const [groupsCount, setGroupsCount] = useState(2);
  const [qualifiedPerGroup, setQualifiedPerGroup] = useState(2);
  const [names, setNames] = useState<string[]>(['', '']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filled = names.map((n) => n.trim()).filter(Boolean);
  const duplicates = filled.some(
    (n, i) => filled.findIndex((x) => x.toLowerCase() === n.toLowerCase()) !== i,
  );
  const isHybrid = type === 'league-knockout' || type === 'groups-knockout';
  const isPlayoff = type === 'playoff';
  const hasGroups = type === 'groups-knockout' || isPlayoff;

  // Options valides selon le nombre de joueurs, avec repli automatique.
  const qualifierOptions = useMemo(
    () => [2, 4, 8, 16].filter((q) => q < filled.length),
    [filled.length],
  );
  const maxGroups = Math.min(8, Math.floor(filled.length / 2));
  const groupOptions = useMemo(
    () => Array.from({ length: Math.max(0, maxGroups - 1) }, (_, i) => i + 2),
    [maxGroups],
  );
  const effQualifiers =
    type === 'league-knockout' && qualifierOptions.includes(qualifiers)
      ? qualifiers
      : (qualifierOptions[qualifierOptions.length - 1] ?? 0);
  const effGroups =
    hasGroups && groupOptions.includes(groupsCount)
      ? groupsCount
      : (groupOptions[groupOptions.length - 1] ?? 0);
  const effPerGroup =
    hasGroups && effGroups * qualifiedPerGroup >= filled.length
      ? 1
      : qualifiedPerGroup;

  const preview = useMemo(() => {
    const n = filled.length;
    if (n < (type === 'knockout' ? 2 : 3)) return null;
    const rrMatches = (n * (n - 1) * (doubleRound ? 2 : 1)) / 2;
    const rrRounds = n - 1 + (doubleRound ? n - 1 : 0);

    switch (type) {
      case 'league':
        return `${rrRounds} journée${rrRounds > 1 ? 's' : ''} · ${rrMatches} match${rrMatches > 1 ? 's' : ''}`;
      case 'league-knockout': {
        if (!effQualifiers) return null;
        const size = bracketSize(effQualifiers);
        const byes = size - effQualifiers;
        return `${rrRounds} journée(s) · ${rrMatches} matchs de championnat → éliminations des ${effQualifiers} premiers${byes > 0 ? ` · ${byes} exempt(s)` : ''}`;
      }
      case 'groups-knockout': {
        if (!effGroups) return null;
        const parGroupe = Math.floor(filled.length / effGroups);
        const mParGroupe = (parGroupe * (parGroupe - 1) * (doubleRound ? 2 : 1)) / 2;
        const qualifies = effGroups * effPerGroup;
        const size = bracketSize(qualifies);
        const byes = size - qualifies;
        return `${effGroups} groupes · ${mParGroupe * effGroups} matchs → éliminations des ${qualifies} qualifiés${byes > 0 ? ` · ${byes} exempt(s)` : ''}`;
      }
      case 'playoff': {
        if (!effGroups) return null;
        const parGroupe = Math.floor(filled.length / effGroups);
        const mParGroupe = (parGroupe * (parGroupe - 1) * (doubleRound ? 2 : 1)) / 2;
        const qualifies = effGroups * effPerGroup;
        const mPlayoff = qualifies * (qualifies - 1) / 2;
        return `${effGroups} groupes · ${mParGroupe * effGroups} matchs → playoff des ${qualifies} meilleurs (${mPlayoff} matchs)`;
      }
      default: {
        const size = bracketSize(n);
        const byes = size - n;
        if (doubleRound) {
          const twoLegTies = size - 1 - byes;
          return `${twoLegTies} confrontations en aller-retour · ${twoLegTies * 2 + byes} matchs`;
        }
        return `Bracket de ${size} · ${size - 1} matchs${byes > 0 ? ` · ${byes} exempt${byes > 1 ? 's' : ''}` : ''}`;
      }
    }
  }, [filled, type, doubleRound, effQualifiers, effGroups, effPerGroup]);

  const configOk =
    type === 'league-knockout' ? effQualifiers > 0 : type === 'groups-knockout' || isPlayoff ? effGroups > 0 : true;
  const canSubmit = name.trim().length > 0 && !duplicates && preview !== null && configOk && !busy;

  const submit = (): void => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    api
      .createTournament({
        name: name.trim(),
        type,
        doubleRound,
        players: filled,
        ...(type === 'league-knockout' ? { qualifiers: effQualifiers } : {}),
        ...(type === 'groups-knockout'
          ? { groupsCount: effGroups, qualifiedPerGroup: effPerGroup }
          : {}),
        ...(isPlayoff
          ? { groupsCount: effGroups, qualifiedPerGroup: effPerGroup }
          : {}),
      })
      .then((t) => navigate(`/t/${t.id}/admin`))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <FadeIn>
        <h1 className="font-display text-2xl tracking-wide sm:text-4xl">NOUVEAU TOURNOI</h1>
        <p className="mt-1 text-slate-400">Configurez le format puis invitez vos joueurs.</p>
      </FadeIn>

      <FadeIn delay={0.08}>
        <Card className="mt-6 space-y-6 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-bold text-slate-300">
              Nom du tournoi
            </label>
            <input
              className="input"
              placeholder="Ex : Coupe des amis 2026"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <span className="mb-2 block text-sm font-bold text-slate-300">Format</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setType(f.value)}
                  aria-pressed={type === f.value}
                  className={`rounded-xl border p-4 text-left transition ${
                    type === f.value
                      ? 'border-lime-400/70 bg-lime-400/10 ring-2 ring-lime-400/20'
                      : 'border-white/10 bg-black/20 hover:border-white/25'
                  }`}
                >
                  <span className="flex h-10 items-center gap-1.5">
                    {f.logos.map((src) => (
                      <img
                        key={src}
                        src={src}
                        alt=""
                        className="h-9 w-auto max-w-[84px] object-contain drop-shadow"
                      />
                    ))}
                  </span>
                  <p className="font-display mt-1 text-xl tracking-wide">{f.label}</p>
                  <p className="text-xs text-slate-400">{f.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {type === 'league-knockout' && (
            <div>
              <label className="mb-1.5 block text-sm font-bold text-slate-300">
                Qualifiés pour les éliminations
                <span className="ml-2 text-xs font-normal text-slate-500">
                  les premiers du championnat
                </span>
              </label>
              <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
                {[2, 4, 8, 16].map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={!qualifierOptions.includes(q)}
                    onClick={() => setQualifiers(q)}
                    aria-pressed={effQualifiers === q}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                      effQualifiers === q
                        ? 'bg-lime-400/20 text-lime-300'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    Top {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasGroups && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-300">
                  Nombre de groupes
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {groupOptions.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroupsCount(g)}
                      aria-pressed={effGroups === g}
                      className={`h-9 w-9 rounded-lg border text-sm font-bold transition ${
                        effGroups === g
                          ? 'border-lime-400/70 bg-lime-400/20 text-lime-300'
                          : 'border-white/10 bg-black/20 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-300">
                  Qualifiés par groupe
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:inline-flex sm:grid-cols-none sm:flex-wrap sm:gap-0">
                  {[1, 2, 3, 4].map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={effGroups * k >= filled.length}
                      onClick={() => setQualifiedPerGroup(k)}
                      aria-pressed={effPerGroup === k}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                        effPerGroup === k
                          ? 'bg-lime-400/20 text-lime-300'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {k === 1 ? 'Le 1er' : `Les ${k} premiers`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div>
            <span className="mb-2 block text-sm font-bold text-slate-300">
              Rencontres
              {type === 'knockout' && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  en cas d'égalité sur l'ensemble des deux matchs : tirs au but
                </span>
              )}
              {isHybrid && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  phase de {type === 'groups-knockout' ? 'groupes' : 'championnat'} — les
                  éliminations se jouent en aller simple (tab si égalité)
                </span>
              )}
              {isPlayoff && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  phase de groupes + playoff entre les meilleurs (points de bonus)
                </span>
              )}
            </span>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setDoubleRound(v)}
                  aria-pressed={doubleRound === v}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    doubleRound === v ? 'bg-lime-400/20 text-lime-300' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {v ? 'Aller-retour' : 'Aller simple'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-300">
                Joueurs ({filled.length}/{type === 'knockout' ? '2–32' : '3–32'})
              </span>
              {names.length < 32 && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5"
                  onClick={() => setNames((n) => [...n, ''])}
                >
                  ＋ Ajouter
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {names.map((value, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input"
                    placeholder={`Joueur ${i + 1}`}
                    value={value}
                    maxLength={30}
                    onChange={(e) =>
                      setNames((arr) => arr.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                  {names.length > 2 && (
                    <button
                      type="button"
                      aria-label={`Retirer le joueur ${i + 1}`}
                      className="btn-danger shrink-0"
                      onClick={() => setNames((arr) => arr.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {duplicates && (
              <p className="mt-2 text-sm font-semibold text-red-400">
                ⚠ Deux joueurs portent le même nom.
              </p>
            )}
          </div>

          {preview && (
            <p className="rounded-xl border border-lime-400/20 bg-lime-400/5 px-4 py-2.5 text-sm font-semibold text-lime-200">
              Aperçu : {preview}
            </p>
          )}

          {error && <p className="text-sm font-semibold text-red-400">{error}</p>}

          <button type="button" className="btn-primary w-full text-lg" disabled={!canSubmit} onClick={submit}>
            {busy ? <Spinner className="h-5 w-5" /> : '🚀 Lancer le tournoi'}
          </button>
        </Card>
      </FadeIn>

      <div className="mt-4 flex justify-center">
        <TypeBadge type={type} />
      </div>
    </div>
  );
}

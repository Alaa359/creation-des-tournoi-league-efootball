import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type UserPublic, type TournamentSummary } from '../../shared/api';
import { Card, FadeIn, Spinner } from '../../ui/primitives';

type TourneySummary = TournamentSummary & { createdBy?: UserPublic; rejectReason?: string };

export function AdminDashboard() {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [tournaments, setTournaments] = useState<TourneySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [u, t] = await Promise.all([api.adminListUsers(), api.adminListTournaments()]);
      setUsers(u);
      setTournaments(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const pendingUsers = users.filter((u) => !u.approved && u.role !== 'admin');
  const activeUsers = users.filter((u) => u.approved && u.role !== 'admin');
  const pendingTournaments = tournaments.filter((t) => t.status === 'pending');

  const resetPassword = async (user: UserPublic) => {
    const password = window.prompt(`Nouveau mot de passe pour ${user.name} (6 caractères min) :`);
    if (!password) return;
    try {
      await api.adminResetPassword(user.id, password);
      alert(`Mot de passe de ${user.name} mis à jour.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const deleteTournament = async (t: TourneySummary) => {
    if (!window.confirm(`Supprimer le tournoi « ${t.name} » ?`)) return;
    try {
      await api.deleteTournament(t.id);
      // retirer les infos locale sans recharger tout l'écran
      setTournaments((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const userTournaments = (userId: string) =>
    tournaments.filter((t) => t.createdBy?.id === userId);


  if (loading) return <div className="py-24 text-center"><Spinner /></div>;
  if (error) return <div className="py-24 text-center text-red-400">{error}</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <FadeIn>
        <h1 className="font-display text-2xl tracking-wide sm:text-4xl">Administration</h1>
        <p className="mt-1 text-slate-400">Gérez les comptes et les demandes de tournois.</p>
      </FadeIn>

      {/* ── Utilisateurs en attente ── */}
      <FadeIn delay={0.08}>
        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-wide text-amber-300">
            Comptes en attente ({pendingUsers.length})
          </h2>
          {pendingUsers.length === 0 ? (
            <Card className="mt-3 p-4 text-sm text-slate-400 italic">Aucune demande en attente.</Card>
          ) : (
            <div className="mt-3 space-y-2">
              {pendingUsers.map((u) => (
                <Card key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-bold text-white">{u.name}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary px-4 py-2 text-sm"
                      onClick={() => api.adminApproveUser(u.id).then(refresh)}
                    >
                      ✓ Approuver
                    </button>
                    <button
                      type="button"
                      className="btn-danger px-4 py-2 text-sm"
                      onClick={() => api.adminDeleteUser(u.id).then(refresh)}
                    >
                      ✕ Refuser
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── Tournois en attente ── */}
      <FadeIn delay={0.15}>
        <section className="mt-8">
          <h2 className="font-display text-2xl tracking-wide text-amber-300">
            Tournois en attente ({pendingTournaments.length})
          </h2>
          {pendingTournaments.length === 0 ? (
            <Card className="mt-3 p-4 text-sm text-slate-400 italic">Aucun tournoi en attente.</Card>
          ) : (
            <div className="mt-3 space-y-2">
              {pendingTournaments.map((t) => (
                <Card key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-bold text-white">{t.name}</p>
                    <p className="text-xs text-slate-400">
                      Créé par {t.createdBy?.name ?? 'Inconnu'} · {t.playerCount} joueurs
                    </p>
                    {t.rejectReason && (
                      <p className="text-xs text-red-400 mt-1">Refusé : {t.rejectReason}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/t/${t.id}/admin`} className="btn-ghost px-3 py-2 text-sm">
                      Voir
                    </Link>
                    <button
                      type="button"
                      className="btn-primary px-4 py-2 text-sm"
                      onClick={() => api.adminApproveTournament(t.id).then(refresh)}
                    >
                      ✓ Approuver
                    </button>
                    <button
                      type="button"
                      className="btn-danger px-4 py-2 text-sm"
                      onClick={() => {
                        const reason = window.confirm('Raison du refus (optionnel)') ? '' : undefined;
                        api.adminRejectTournament(t.id, reason).then(refresh);
                      }}
                    >
                      ✕ Refuser
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── Utilisateurs actifs ── */}
      <FadeIn delay={0.22}>
        <section className="mt-8">
          <h2 className="font-display text-2xl tracking-wide text-emerald-300">
            Utilisateurs actifs ({activeUsers.length})
          </h2>
          <div className="mt-3 space-y-2">
            {activeUsers.map((u) => {
              const isOpen = openUser === u.id;
              const uTournaments = userTournaments(u.id);
              return (
                <div key={u.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-bold text-white">{u.name}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => setOpenUser(isOpen ? null : u.id)}
                      >
                        {isOpen ? 'Masquer les tournois' : `Voir les tournois de ${u.name}`}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => resetPassword(u)}
                      >
                        Réinitialiser mot de passe
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-3 py-1.5 text-xs"
                        onClick={() => api.adminRejectUser(u.id).then(refresh)}
                      >
                        Désactiver
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-3 py-1.5 text-xs"
                        onClick={() => {
                          if (window.confirm(`Supprimer le compte de ${u.name} ?`)) {
                            api.adminDeleteUser(u.id).then(refresh);
                          }
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </Card>

                  {isOpen && (
                    <div className="mt-2 space-y-2 pl-2">
                      {uTournaments.length === 0 ? (
                        <Card className="p-4 text-sm text-slate-400 italic">
                          {u.name} n'a créé aucun tournoi.
                        </Card>
                      ) : (
                        uTournaments.map((t) => (
                          <Card key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                            <div className="min-w-0">
                              <p className="font-bold text-white">{t.name}</p>
                              <p className="text-xs text-slate-400">
                                {t.type} · {t.playerCount} joueurs · {new Date(t.createdAt).toLocaleDateString('fr-FR')}
                              </p>
                              {(t.status === 'active' || t.status === 'pending') && (
                                <p className="text-xs text-slate-500">Statut : {t.status}</p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Link to={`/t/${t.id}`} className="btn-ghost px-3 py-1.5 text-xs">
                                Voir
                              </Link>
                              <button
                                type="button"
                                className="btn-danger px-3 py-1.5 text-xs"
                                onClick={() => deleteTournament(t)}
                              >
                                Supprimer
                              </button>
                            </div>
                          </Card>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </FadeIn>
    </div>
  );
}

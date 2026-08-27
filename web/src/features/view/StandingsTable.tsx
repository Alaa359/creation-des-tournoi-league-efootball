import { motion } from 'motion/react';
import type { StandingRow } from '../../shared/api';
import { Card, PlayerAvatar } from '../../ui/primitives';

export function StandingsTable({
  rows,
  title,
  showBonus = false,
}: {
  rows: (StandingRow & { bonus?: number; bonusLabel?: string })[];
  title?: string;
  showBonus?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      {title && (
        <h3 className="font-display border-b border-white/10 px-3 py-2.5 text-sm tracking-widest text-slate-300 uppercase">
          {title}
        </h3>
      )}
      {/* Sur mobile, le tableau défile horizontalement pour garder TOUTES les colonnes visibles. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs tracking-wider text-slate-400 uppercase">
            <th className="px-3 py-3">#</th>
            <th className="px-3 py-3">Joueur</th>
            <th className="px-2 py-3 text-center">J</th>
            <th className="px-2 py-3 text-center">G</th>
            <th className="px-2 py-3 text-center">N</th>
            <th className="px-2 py-3 text-center">P</th>
            <th className="px-2 py-3 text-center">BP</th>
            <th className="px-2 py-3 text-center">BC</th>
            <th className="px-2 py-3 text-center">Diff</th>
            {showBonus && <th className="px-2 py-3 text-center">Bonus</th>}
            <th className="px-3 py-3 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr
              key={row.playerId}
              layout
              transition={{ layout: { duration: 0.45, ease: 'easeOut' } }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`border-b border-white/5 last:border-0 ${
                i === 0 ? 'bg-amber-300/[0.07]' : ''
              }`}
            >
              <td className="px-3 py-2.5">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-extrabold ${
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
              </td>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2 font-bold">
                  <PlayerAvatar name={row.name} />
                  <span className="truncate">{row.name}</span>
                </span>
              </td>
              <td className="px-2 py-2.5 text-center text-slate-300">{row.played}</td>
              <td className="px-2 py-2.5 text-center text-slate-300">{row.won}</td>
              <td className="px-2 py-2.5 text-center text-slate-300">{row.drawn}</td>
              <td className="px-2 py-2.5 text-center text-slate-300">{row.lost}</td>
              <td className="px-2 py-2.5 text-center text-slate-300">{row.goalsFor}</td>
              <td className="px-2 py-2.5 text-center text-slate-300">{row.goalsAgainst}</td>
              <td
                className={`px-2 py-2.5 text-center font-semibold ${
                  row.goalDiff > 0 ? 'text-lime-300' : row.goalDiff < 0 ? 'text-red-400' : 'text-slate-400'
                }`}
              >
                {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
              </td>
              {showBonus && (
                <td className="px-2 py-2.5 text-center">
                  {row.bonus != null && row.bonus > 0 ? (
                    <span className="text-xs font-semibold text-emerald-300" title={row.bonusLabel}>
                      +{row.bonus}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
              )}
              <td className="px-3 py-2.5 text-right font-display text-xl text-white">
                {row.points}
              </td>
            </motion.tr>
          ))}
        </tbody>
        </table>
      </div>
    </Card>
  );
}

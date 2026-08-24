import { motion } from 'motion/react';
import type { StandingRow } from '../../shared/api';
import { Card, PlayerAvatar } from '../../ui/primitives';

export function StandingsTable({ rows, title }: { rows: StandingRow[]; title?: string }) {
  return (
    <Card className="overflow-hidden">
      {title && (
        <h3 className="font-display border-b border-white/10 px-3 py-2.5 text-sm tracking-widest text-slate-300 uppercase">
          {title}
        </h3>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs tracking-wider text-slate-400 uppercase">
            <th className="px-3 py-3">#</th>
            <th className="px-3 py-3">Joueur</th>
            <th className="px-2 py-3 text-center">J</th>
            <th className="hidden px-2 py-3 text-center sm:table-cell">G</th>
            <th className="hidden px-2 py-3 text-center sm:table-cell">N</th>
            <th className="hidden px-2 py-3 text-center sm:table-cell">P</th>
            <th className="hidden px-2 py-3 text-center md:table-cell">BP</th>
            <th className="hidden px-2 py-3 text-center md:table-cell">BC</th>
            <th className="px-2 py-3 text-center">Diff</th>
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
              <td className="hidden px-2 py-2.5 text-center sm:table-cell">{row.won}</td>
              <td className="hidden px-2 py-2.5 text-center sm:table-cell">{row.drawn}</td>
              <td className="hidden px-2 py-2.5 text-center sm:table-cell">{row.lost}</td>
              <td className="hidden px-2 py-2.5 text-center md:table-cell">{row.goalsFor}</td>
              <td className="hidden px-2 py-2.5 text-center md:table-cell">{row.goalsAgainst}</td>
              <td
                className={`px-2 py-2.5 text-center font-semibold ${
                  row.goalDiff > 0 ? 'text-lime-300' : row.goalDiff < 0 ? 'text-red-400' : 'text-slate-400'
                }`}
              >
                {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
              </td>
              <td className="px-3 py-2.5 text-right font-display text-xl text-white">
                {row.points}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/** Durée d'affichage d'un visuel du diaporama de fond (ms). */
export const SLIDE_INTERVAL_MS = 7000;

interface BackgroundSlide {
  /** Visuel principal optimisé (WebP pré-généré). */
  src: string;
  /** Halo ambiant avec flou et saturation déjà cuits dans le fichier. */
  halo: string;
  title: string;
  subtitle: string;
  /** Photo rectangulaire : présentée dans un cadre vitré plutôt qu'à nu. */
  framed?: boolean;
}

/** Visuels diffusés en fond de site — chaque photo/logo reste 7 s.
 *  Fichiers générés par `npm run bg` (scripts/bg-assets.mjs) : aucun filtre
 *  CSS n'est appliqué à l'exécution, seule une transformation GPU anime les calques. */
const BACKGROUND_SLIDES: BackgroundSlide[] = [
  {
    src: '/backgrounds/gen/laliga.webp',
    halo: '/backgrounds/gen/laliga-halo.webp',
    title: 'LALIGA',
    subtitle: 'Espagne',
  },
  {
    src: '/backgrounds/gen/laliga-trophy.webp',
    halo: '/backgrounds/gen/laliga-trophy-halo.webp',
    title: 'TROPHÉE LALIGA',
    subtitle: 'Le trophée espagnol',
    framed: true,
  },
  {
    src: '/backgrounds/gen/premierleague.webp',
    halo: '/backgrounds/gen/premierleague-halo.webp',
    title: 'PREMIER LEAGUE',
    subtitle: 'Angleterre',
  },
  {
    src: '/backgrounds/gen/premierleague-trophy.webp',
    halo: '/backgrounds/gen/premierleague-trophy-halo.webp',
    title: 'TROPHÉE PREMIER LEAGUE',
    subtitle: 'Le trophée anglais',
    framed: true,
  },
  {
    src: '/backgrounds/gen/ligue1.webp',
    halo: '/backgrounds/gen/ligue1-halo.webp',
    title: 'LIGUE 1',
    subtitle: 'France',
  },
  {
    src: '/backgrounds/gen/tunisie.webp',
    halo: '/backgrounds/gen/tunisie-halo.webp',
    title: 'LIGUE 1 PRO',
    subtitle: 'Tunisie',
  },
  {
    src: '/backgrounds/gen/ucl.webp',
    halo: '/backgrounds/gen/ucl-halo.webp',
    title: 'CHAMPIONS LEAGUE',
    subtitle: 'La coupe aux grandes oreilles',
  },
  {
    src: '/backgrounds/gen/worldcup.webp',
    halo: '/backgrounds/gen/worldcup-halo.webp',
    title: 'COUPE DU MONDE',
    subtitle: 'FIFA World Cup',
  },
  {
    src: '/backgrounds/gen/wc2026.webp',
    halo: '/backgrounds/gen/wc2026-halo.webp',
    title: 'COUPE DU MONDE 2026',
    subtitle: 'Canada · Mexique · États-Unis',
  },
];

/**
 * Diaporama plein écran derrière tout le site : fondu enchaîné + zoom
 * Ken Burns + halo flouté dérivé du visuel, sous un voile sombre qui
 * préserve la lisibilité de l'interface.
 */
export function BackgroundSlideshow() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % BACKGROUND_SLIDES.length);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  // Précharge de tous les visuels pour éviter tout flash au changement.
  useEffect(() => {
    for (const s of BACKGROUND_SLIDES) {
      new Image().src = s.src;
      new Image().src = s.halo;
    }
  }, []);

  const slide = BACKGROUND_SLIDES[index];
  const kbSeconds = SLIDE_INTERVAL_MS / 1000 + 1.5;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <AnimatePresence>
        <motion.div
          key={slide.src}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
        >
          {/* Halo ambiant : version minuscule pré-floutée, étirée plein écran — zéro filtre. */}
          <img
            src={slide.halo}
            alt=""
            className="absolute inset-[-10%] h-[120%] w-[120%] object-cover opacity-25"
          />

          {/* Visuel principal : zoom Ken Burns en animation CSS (compositée GPU). */}
          <div
            className="kb-zoom absolute inset-0 flex items-center justify-center"
            style={{ ['--kb-duration' as string]: `${kbSeconds}s` }}
          >
            {slide.framed ? (
              <div className="rounded-3xl border border-white/15 bg-white/[0.06] p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.85)] backdrop-blur-sm">
                <img
                  src={slide.src}
                  alt=""
                  className="max-h-[42vh] w-auto max-w-[58vw] rounded-2xl object-contain"
                />
              </div>
            ) : (
              <img
                src={slide.src}
                alt=""
                className="max-h-[46vh] w-auto max-w-[70vw] object-contain px-6 drop-shadow-[0_12px_32px_rgba(0,0,0,0.7)]"
              />
            )}
          </div>

          {/* Légende façon broadcast. */}
          <div className="absolute inset-x-0 bottom-[15vh] flex flex-col items-center gap-1 px-4 text-center">
            <motion.h2
              className="font-display text-5xl tracking-widest text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)] sm:text-6xl"
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.7, ease: 'easeOut' }}
            >
              {slide.title}
            </motion.h2>
            <motion.p
              className="text-sm font-bold tracking-[0.3em] text-lime-300/90 uppercase drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.6, ease: 'easeOut' }}
            >
              {slide.subtitle}
            </motion.p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Voile sombre pour le contraste de l'interface par-dessus le fond. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b0f19]/80 via-[#0b0f19]/50 to-[#0b0f19]/90" />

      {/* Indicateurs de progression du diaporama. */}
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
        {BACKGROUND_SLIDES.map((s, i) => (
          <span
            key={s.src}
            className={`h-1 rounded-full transition-all duration-500 ${
              i === index ? 'w-6 bg-lime-400/90' : 'w-2 bg-white/25'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/** Ballon rebondissant — état de chargement thématique. */
export function BallLoader({ size = 'text-4xl' }: { size?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.span
        className={size}
        animate={{ y: [0, -18, 0], rotate: [0, 200, 360] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
      >
        ⚽
      </motion.span>
      <span className="text-sm font-semibold text-slate-400">Chargement…</span>
    </div>
  );
}

const COLORS = ['#a3e635', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#f8fafc'];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
  drift: number;
}

function usePieces(count: number): Piece[] {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.6 + Math.random() * 1.6,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 7,
        drift: (Math.random() - 0.5) * 160,
      })),
    [count],
  );
}

/** Pluie de confettis affichée tant que `active` est vrai. */
export function Confetti({ active }: { active: boolean }) {
  const pieces = usePieces(90);
  return (
    <AnimatePresence>
      {active && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
          {pieces.map((p, i) => (
            <motion.span
              key={i}
              className="absolute top-[-5vh] block"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 1.4,
                background: p.color,
                borderRadius: 2,
              }}
              initial={{ y: '-5vh', opacity: 1, x: 0 }}
              animate={{ y: '110vh', x: p.drift, rotate: 360 * (i % 2 ? 1 : -1), opacity: [1, 1, 0.9] }}
              exit={{ opacity: 0 }}
              transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}

/** Coup d'envoi : petit ballon animé pour les titres. */
export function RollingBall({ className = '' }: { className?: string }) {
  return (
    <motion.span
      className={`inline-block select-none ${className}`}
      animate={{ rotate: [0, 360] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
    >
      ⚽
    </motion.span>
  );
}

/** Affiche les confettis pendant quelques secondes lorsque `trigger` passe à vrai. */
export function useTimedFlag(trigger: boolean, ms = 5000): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!trigger) {
      setShow(false);
      return undefined;
    }
    setShow(true);
    const t = setTimeout(() => setShow(false), ms);
    return () => clearTimeout(t);
  }, [trigger, ms]);
  return show;
}

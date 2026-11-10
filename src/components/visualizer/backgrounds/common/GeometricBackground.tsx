import React, { useMemo } from 'react';
import { AnimatePresence, motion, MotionValue, useSpring, useTransform } from 'framer-motion';
import { AudioBands, Theme } from '../../../../types';
import { useLucideIcons } from '../../../../hooks/useLucideIcons';
import { getLucideIconStatus, resolveLucideIcon } from '../../../../services/lucideIconResolver';
import './GeometricBackground.css';

// src/components/visualizer/backgrounds/common/GeometricBackground.tsx

interface GeometricBackgroundProps {
  theme: Theme;
  audioPower: MotionValue<number>;
  audioBands?: AudioBands;
  seed?: string | number;
  hideShapes?: boolean;
  disableVignette?: boolean;
  paused?: boolean;
}

type ShapeType = 'circle' | 'square' | 'triangle' | 'cross';
type ScaleKey = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble' | 'default';

interface BackgroundShape {
  id: number;
  type: ShapeType;
  /** Which of the theme's icons the shape shows instead, as a share of their count; null for never. */
  iconSlot: number | null;
  initialX: number;
  initialY: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  reverse: boolean;
  filled: boolean;
  initialRotation: number;
}

interface BackgroundParticle {
  id: number;
  size: number;
  left: number;
  top: number;
  opacity: number;
  duration: number;
  delay: number;
}

const getShapeScaleKey = (shape: BackgroundShape): ScaleKey => {
  switch (shape.type) {
    case 'circle':
      return 'bass';
    case 'square':
      return 'lowMid';
    case 'triangle':
      return 'mid';
    case 'cross':
      return 'treble';
    default:
      return 'default';
  }
};

const getShapeClipPath = (shapeType: ShapeType) => {
  if (shapeType === 'triangle') {
    return 'polygon(50% 0%, 0% 100%, 100% 100%)';
  }

  if (shapeType === 'cross') {
    return 'polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)';
  }

  return 'none';
};

const getShapeFaceStyle = (shape: BackgroundShape, theme: Theme) => {
  const isCircleOrSquare = shape.type === 'circle' || shape.type === 'square';
  const useStroke = isCircleOrSquare && !shape.filled;

  return {
    border: useStroke ? `1px solid ${theme.secondaryColor}` : 'none',
    backgroundColor: !useStroke ? theme.secondaryColor : 'transparent',
    borderRadius: shape.type === 'circle' ? '50%' : '0%',
    opacity: shape.opacity,
    clipPath: getShapeClipPath(shape.type),
  };
};

/** Where a shape sits, and its drift and turn (GeometricBackground.css). */
const getShapeDriftStyle = (shape: BackgroundShape) => ({
  left: `${shape.initialX}%`,
  top: `${shape.initialY}%`,
  width: shape.size,
  height: shape.size,
  animationDuration: `${shape.duration}s`,
  animationDelay: `${shape.delay}s`,
  '--geometric-dir': shape.reverse ? -1 : 1,
  '--geometric-rotate': `${shape.initialRotation}deg`,
}) as React.CSSProperties;

/**
 * The theme icon an icon slot shows: 'loading' while its chunk is still on the way, null where the
 * theme has none or the name is not an icon.
 */
const getShapeIcon = (shape: BackgroundShape, icons: string[]): ReturnType<typeof resolveLucideIcon> | 'loading' => {
  if (shape.iconSlot === null || icons.length === 0) return null;
  const name = icons[Math.floor(shape.iconSlot * icons.length)];
  if (getLucideIconStatus(name) === 'loading') return 'loading';
  return resolveLucideIcon(name);
};

const VignetteOverlay: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => (
  disabled ? null : (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.6) 100%)' }}
    />
  )
);

/*
 * The shapes and particles. Each moves on a CSS loop of its own; a pause holds every loop where it
 * is and play goes on from there, so pausing (also the moment the next track loads) moves nothing.
 * The colours follow a new theme over a second, as the base colour does.
 */
const GeometricScene: React.FC<{
  theme: Theme;
  audioPower: MotionValue<number>;
  audioBands?: AudioBands;
  shapes: BackgroundShape[];
  particles: BackgroundParticle[];
  hideShapes: boolean;
  disableVignette: boolean;
  paused: boolean;
}> = ({ theme, audioPower, audioBands, shapes, particles, hideShapes, disableVignette, paused }) => {
  const useBandScale = (value: MotionValue<number> | undefined) => {
    const source = value || audioPower;
    const spring = useSpring(source, { stiffness: 300, damping: 30 }) as unknown as MotionValue<number>;
    return useTransform(spring, [10, 200], [0.95, 1.45]);
  };

  const scales: Record<ScaleKey, MotionValue<number>> = {
    bass: useBandScale(audioBands?.bass),
    lowMid: useBandScale(audioBands?.lowMid),
    mid: useBandScale(audioBands?.mid),
    vocal: useBandScale(audioBands?.vocal),
    treble: useBandScale(audioBands?.treble),
    default: useBandScale(audioPower),
  };
  const icons = theme.lyricsIcons || [];

  return (
    <div className={paused ? 'absolute inset-0 geometric-paused' : 'absolute inset-0'}>
      {!hideShapes && (
        <>
          {shapes.map((shape) => {
            // While the icon's chunk is still loading the slot shows neither its face nor the icon, rather
            // than flash the face before the icon comes in.
            const icon = getShapeIcon(shape, icons);
            const IconComponent = icon === 'loading' ? null : icon;

            return (
              <div key={shape.id} className="absolute geometric-drift" style={getShapeDriftStyle(shape)}>
                <motion.div
                  className="w-full h-full transition-[color,background-color,border-color,opacity] duration-1000"
                  style={{
                    ...getShapeFaceStyle(shape, theme),
                    ...(icon !== null ? { opacity: 0 } : {}),
                    scale: scales[getShapeScaleKey(shape)],
                  }}
                />
                {/* An icon slot keeps its pulse running whether the theme has icons or not, so
                    icons arriving or leaving cross-fade with the face instead of restarting it. */}
                {shape.iconSlot !== null && (
                  <div className="absolute inset-0 transition-opacity duration-1000" style={{ opacity: IconComponent ? 1 : 0 }}>
                    <motion.div
                      className="w-full h-full flex items-center justify-center geometric-pulse transition-colors duration-1000"
                      style={{
                        color: theme.secondaryColor,
                        scale: scales.vocal,
                        animationDuration: `${shape.duration * 0.5}s`,
                        animationDelay: `${shape.delay}s`,
                        '--geometric-peak': shape.opacity * 3,
                      } as React.ComponentProps<typeof motion.div>['style']}
                    >
                      {IconComponent && <IconComponent size={shape.size} strokeWidth={1} absoluteStrokeWidth />}
                    </motion.div>
                  </div>
                )}
              </div>
            );
          })}

          {particles.map((particle) => (
            <div
              key={`p-${particle.id}`}
              className="absolute rounded-full geometric-rise transition-colors duration-1000"
              style={{
                backgroundColor: theme.accentColor,
                width: particle.size,
                height: particle.size,
                left: `${particle.left}%`,
                top: `${particle.top}%`,
                animationDuration: `${particle.duration}s`,
                animationDelay: `${particle.delay}s`,
                '--geometric-peak': particle.opacity,
              } as React.CSSProperties}
            />
          ))}
        </>
      )}

      <VignetteOverlay disabled={disableVignette} />
    </div>
  );
};

const GeometricLayer: React.FC<GeometricBackgroundProps> = ({
  theme,
  audioPower,
  audioBands,
  seed,
  hideShapes = false,
  disableVignette = false,
  paused = false,
}) => {
  // Re-renders the scene below as the theme's icons arrive.
  useLucideIcons(theme.lyricsIcons);

  // Laid out from the seed alone. The theme often comes after the song, each time with a new icon
  // list: it only changes what an icon slot shows (getShapeIcon), in its place.
  const shapes = useMemo<BackgroundShape[]>(() => {
    const shapeTypes: ShapeType[] = ['circle', 'square', 'triangle', 'cross'];

    let iconSlots = 0;
    return Array.from({ length: 15 }).map((_, index) => {
      const iconSlot = iconSlots < 6 && Math.random() > 0.7 ? Math.random() : null;
      if (iconSlot !== null) {
        iconSlots += 1;
      }

      return {
        id: index,
        type: shapeTypes[Math.floor(Math.random() * shapeTypes.length)],
        iconSlot,
        initialX: Math.random() * 100,
        initialY: Math.random() * 100,
        size: 40 + Math.random() * 100,
        duration: iconSlot !== null ? 20 + Math.random() * 20 : 30 + Math.random() * 30,
        delay: Math.random() * 5,
        opacity: 0.11 + Math.random() * 0.08,
        reverse: Math.random() > 0.5,
        filled: Math.random() < 0.3,
        initialRotation: Math.random() * 360,
      };
    });
  }, [seed]);

  const particles = useMemo<BackgroundParticle[]>(() => (
    Array.from({ length: 20 }).map((_, index) => ({
      id: index,
      size: Math.random() * 4 + 1,
      left: Math.random() * 100,
      top: Math.random() * 100,
      opacity: Math.random() * 0.3,
      duration: 15 + Math.random() * 20,
      delay: Math.random() * 10,
    }))
  ), [seed]);

  return (
    <motion.div
      className="absolute inset-0"
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
    >
      <GeometricScene
        theme={theme}
        audioPower={audioPower}
        audioBands={audioBands}
        shapes={shapes}
        particles={particles}
        hideShapes={hideShapes}
        disableVignette={disableVignette}
        paused={paused}
      />
    </motion.div>
  );
};

const GeometricBackground: React.FC<GeometricBackgroundProps> = React.memo((props) => {
  const layerKey = String(props.seed ?? 'default');

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Do NOT use initial={false} on AnimatePresence here.
          initial={false} propagates via context to ALL nested motion components,
          causing keyframe animations with repeat:Infinity to never be dispatched
          on mount. Removing it allows the container to fade in (0.6s) and all
          child keyframe animations to start normally on every mount.
          The layer itself now shows at once (initial={false} on GeometricLayer's own
          motion.div, which does not reach its children): a new seed is a new copy of
          the background, which the background layer around it brings in. */}
      <AnimatePresence mode="sync">
        <GeometricLayer key={layerKey} {...props} />
      </AnimatePresence>
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.seed !== nextProps.seed) return false;
  if (prevProps.audioPower !== nextProps.audioPower) return false;
  if (prevProps.hideShapes !== nextProps.hideShapes) return false;
  if (prevProps.disableVignette !== nextProps.disableVignette) return false;
  if (prevProps.paused !== nextProps.paused) return false;

  const previousBands = prevProps.audioBands;
  const nextBands = nextProps.audioBands;

  if (!previousBands !== !nextBands) return false;

  let bandsEqual = true;
  if (previousBands && nextBands) {
    bandsEqual =
      previousBands.bass === nextBands.bass &&
      previousBands.lowMid === nextBands.lowMid &&
      previousBands.mid === nextBands.mid &&
      previousBands.vocal === nextBands.vocal &&
      previousBands.treble === nextBands.treble;
  }
  if (!bandsEqual) return false;

  const previousTheme = prevProps.theme;
  const nextTheme = nextProps.theme;

  const colorsEqual =
    previousTheme.backgroundColor === nextTheme.backgroundColor &&
    previousTheme.primaryColor === nextTheme.primaryColor &&
    previousTheme.secondaryColor === nextTheme.secondaryColor &&
    previousTheme.accentColor === nextTheme.accentColor;

  const iconsEqual = Boolean(
    previousTheme.lyricsIcons === nextTheme.lyricsIcons ||
    (previousTheme.lyricsIcons?.length === nextTheme.lyricsIcons?.length &&
      previousTheme.lyricsIcons?.every((value, index) => value === nextTheme.lyricsIcons?.[index]))
  );

  return colorsEqual && iconsEqual;
});

export default GeometricBackground;

import React, { useMemo } from 'react';
import { AnimatePresence, motion, MotionValue, useSpring, useTransform } from 'framer-motion';
import * as LucideIcons from 'lucide-react';
import { AudioBands, Theme } from '../../types';

interface GeometricBackgroundProps {
  theme: Theme;
  audioPower: MotionValue<number>;
  audioBands?: AudioBands;
  seed?: string | number;
  hideShapes?: boolean;
  paused?: boolean;
}

type ShapeType = 'circle' | 'square' | 'triangle' | 'cross' | 'icon';
type ScaleKey = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble' | 'default';

interface BackgroundShape {
  id: number;
  type: ShapeType;
  iconName: string | null;
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
    case 'icon':
      return 'vocal';
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

const getShapeBaseStyle = (shape: BackgroundShape, theme: Theme) => {
  const isCircleOrSquare = shape.type === 'circle' || shape.type === 'square';
  const useStroke = isCircleOrSquare && !shape.filled;

  return {
    left: `${shape.initialX}%`,
    top: `${shape.initialY}%`,
    width: shape.size,
    height: shape.size,
    border: useStroke ? `1px solid ${theme.secondaryColor}` : 'none',
    backgroundColor: !useStroke ? theme.secondaryColor : 'transparent',
    borderRadius: shape.type === 'circle' ? '50%' : '0%',
    opacity: shape.opacity,
    clipPath: getShapeClipPath(shape.type),
  };
};

const GradientOverlay = () => (
  <div
    className="absolute inset-0 pointer-events-none"
    style={{ background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.6) 100%)' }}
  />
);

const StaticGeometricScene: React.FC<{
  theme: Theme;
  shapes: BackgroundShape[];
  particles: BackgroundParticle[];
  hideShapes: boolean;
}> = ({ theme, shapes, particles, hideShapes }) => (
  <div className="absolute inset-0">
    {!hideShapes && (
      <>
        {shapes.map((shape) => {
          if (shape.type === 'icon' && shape.iconName) {
            const IconComponent = LucideIcons[shape.iconName as keyof typeof LucideIcons] as LucideIcons.LucideIcon | undefined;

            if (IconComponent) {
              return (
                <div
                  key={shape.id}
                  className="absolute flex items-center justify-center"
                  style={{
                    left: `${shape.initialX}%`,
                    top: `${shape.initialY}%`,
                    width: shape.size,
                    height: shape.size,
                    color: theme.secondaryColor,
                    opacity: shape.opacity,
                    transform: `rotate(${shape.initialRotation}deg)`,
                  }}
                >
                  <IconComponent size={shape.size} strokeWidth={1} absoluteStrokeWidth />
                </div>
              );
            }
          }

          return (
            <div
              key={shape.id}
              className="absolute"
              style={{
                ...getShapeBaseStyle(shape, theme),
                transform: `rotate(${shape.initialRotation}deg)`,
              }}
            />
          );
        })}

        {particles.map((particle) => (
          <div
            key={`p-${particle.id}`}
            className="absolute rounded-full"
            style={{
              backgroundColor: theme.accentColor,
              width: particle.size,
              height: particle.size,
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              opacity: particle.opacity,
            }}
          />
        ))}
      </>
    )}

    <GradientOverlay />
  </div>
);

const AnimatedGeometricScene: React.FC<{
  theme: Theme;
  audioPower: MotionValue<number>;
  audioBands?: AudioBands;
  shapes: BackgroundShape[];
  particles: BackgroundParticle[];
  hideShapes: boolean;
}> = ({ theme, audioPower, audioBands, shapes, particles, hideShapes }) => {
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

  return (
    <div className="absolute inset-0">
      {!hideShapes && (
        <>
          {shapes.map((shape) => {
            if (shape.type === 'icon' && shape.iconName) {
              const IconComponent = LucideIcons[shape.iconName as keyof typeof LucideIcons] as LucideIcons.LucideIcon | undefined;

              if (IconComponent) {
                return (
                  <motion.div
                    key={shape.id}
                    className="absolute flex items-center justify-center"
                    style={{
                      left: `${shape.initialX}%`,
                      top: `${shape.initialY}%`,
                      width: shape.size,
                      height: shape.size,
                      color: theme.secondaryColor,
                      scale: scales.vocal,
                    }}
                    animate={{
                      y: shape.reverse ? [-30, 30, -30] : [30, -30, 30],
                      x: shape.reverse ? [15, -15, 15] : [-15, 15, -15],
                      rotate: [shape.initialRotation, shape.initialRotation + 360],
                      opacity: [0, shape.opacity * 3, 0],
                    }}
                    transition={{
                      duration: shape.duration,
                      repeat: Infinity,
                      ease: 'linear',
                      delay: shape.delay,
                      opacity: {
                        duration: shape.duration * 0.5,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: shape.delay,
                      },
                    }}
                  >
                    <IconComponent size={shape.size} strokeWidth={1} absoluteStrokeWidth />
                  </motion.div>
                );
              }
            }

            return (
              <motion.div
                key={shape.id}
                className="absolute"
                style={{
                  ...getShapeBaseStyle(shape, theme),
                  scale: scales[getShapeScaleKey(shape)],
                }}
                animate={{
                  y: shape.reverse ? [-30, 30, -30] : [30, -30, 30],
                  x: shape.reverse ? [15, -15, 15] : [-15, 15, -15],
                  rotate: [shape.initialRotation, shape.initialRotation + 360],
                }}
                transition={{
                  duration: shape.duration,
                  repeat: Infinity,
                  ease: 'linear',
                  delay: shape.delay,
                }}
              />
            );
          })}

          {particles.map((particle) => (
            <motion.div
              key={`p-${particle.id}`}
              className="absolute rounded-full"
              style={{
                backgroundColor: theme.accentColor,
                width: particle.size,
                height: particle.size,
                left: `${particle.left}%`,
                top: `${particle.top}%`,
                opacity: particle.opacity,
              }}
              animate={{
                y: [0, -100],
                opacity: [0, particle.opacity, 0],
              }}
              transition={{
                duration: particle.duration,
                repeat: Infinity,
                ease: 'linear',
                delay: particle.delay,
              }}
            />
          ))}
        </>
      )}

      <GradientOverlay />
    </div>
  );
};

const GeometricLayer: React.FC<GeometricBackgroundProps> = ({
  theme,
  audioPower,
  audioBands,
  seed,
  hideShapes = false,
  paused = false,
}) => {
  const shapes = useMemo<BackgroundShape[]>(() => {
    const shapeTypes: Array<Exclude<ShapeType, 'icon'>> = ['circle', 'square', 'triangle', 'cross'];
    const availableIcons = theme.lyricsIcons || [];

    let iconCount = 0;
    return Array.from({ length: 15 }).map((_, index) => {
      const wantIcon = availableIcons.length > 0 && Math.random() > 0.7;
      const useIcon = wantIcon && iconCount < 6;
      if (useIcon) {
        iconCount += 1;
      }

      const iconName = useIcon ? availableIcons[Math.floor(Math.random() * availableIcons.length)] : null;

      return {
        id: index,
        type: useIcon ? 'icon' : shapeTypes[Math.floor(Math.random() * shapeTypes.length)],
        iconName,
        initialX: Math.random() * 100,
        initialY: Math.random() * 100,
        size: 40 + Math.random() * 100,
        duration: useIcon ? 20 + Math.random() * 20 : 30 + Math.random() * 30,
        delay: Math.random() * 5,
        opacity: 0.11 + Math.random() * 0.08,
        reverse: Math.random() > 0.5,
        filled: Math.random() < 0.3,
        initialRotation: Math.random() * 360,
      };
    });
  }, [theme.lyricsIcons, seed]);

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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
    >
      {paused ? (
        <StaticGeometricScene
          theme={theme}
          shapes={shapes}
          particles={particles}
          hideShapes={hideShapes}
        />
      ) : (
        <AnimatedGeometricScene
          theme={theme}
          audioPower={audioPower}
          audioBands={audioBands}
          shapes={shapes}
          particles={particles}
          hideShapes={hideShapes}
        />
      )}
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
          child keyframe animations to start normally on every mount. */}
      <AnimatePresence mode="sync">
        <GeometricLayer key={layerKey} {...props} />
      </AnimatePresence>
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.seed !== nextProps.seed) return false;
  if (prevProps.audioPower !== nextProps.audioPower) return false;
  if (prevProps.hideShapes !== nextProps.hideShapes) return false;
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

  const iconsEqual =
    previousTheme.lyricsIcons === nextTheme.lyricsIcons ||
    (previousTheme.lyricsIcons?.length === nextTheme.lyricsIcons?.length &&
      previousTheme.lyricsIcons?.every((value, index) => value === nextTheme.lyricsIcons?.[index]));

  return colorsEqual && iconsEqual;
});

export default GeometricBackground;

import React, { useMemo } from 'react';
import { motion, MotionValue, useTransform, useSpring } from 'framer-motion';
import * as LucideIcons from 'lucide-react';
import { Theme, AudioBands } from '../types';

interface GeometricBackgroundProps {
  theme: Theme;
  audioPower: MotionValue<number>;
  audioBands?: AudioBands; // Optional to prevent breaking if not passed immediately
  seed?: string | number; // Added seed for forcing regeneration
}

const GeometricBackground: React.FC<GeometricBackgroundProps> = React.memo(({ theme, audioPower, audioBands, seed }) => {
  // Generate static random configuration for shapes to prevent jitter on re-renders
  const shapes = useMemo(() => {
    const shapeTypes = ['circle', 'square', 'triangle', 'cross'];
    const availableIcons = theme.lyricsIcons || [];

    let iconCount = 0;
    // Increased total shapes slightly to accommodate more variety
    return Array.from({ length: 15 }).map((_, i) => {
      // 30% chance to use an icon if available, max 6 icons
      const wantIcon = availableIcons.length > 0 && Math.random() > 0.7;
      const useIcon = wantIcon && iconCount < 6;
      if (useIcon) iconCount++;

      const iconName = useIcon ? availableIcons[Math.floor(Math.random() * availableIcons.length)] : null;

      return {
        id: i,
        type: useIcon ? 'icon' : shapeTypes[Math.floor(Math.random() * shapeTypes.length)],
        iconName,
        initialX: Math.random() * 100,
        initialY: Math.random() * 100,
        size: 40 + Math.random() * 100,
        // Icons move/fade faster (20s-40s), shapes move slower (30s-60s)
        duration: useIcon ? 20 + Math.random() * 20 : 30 + Math.random() * 30,
        delay: Math.random() * 5,
        opacity: 0.11 + Math.random() * 0.08, // Increased opacity for better visibility
        reverse: Math.random() > 0.5,
        // Randomly decide if circle/square should be filled (30% chance filled)
        filled: Math.random() < 0.3,
        initialRotation: Math.random() * 360
      };
    });
  }, [theme.lyricsIcons, seed]); // Re-generate if icons change OR seed changes

  // Stable particle configuration
  const particles = useMemo(() => {
    return Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      size: Math.random() * 4 + 1,
      left: Math.random() * 100,
      top: Math.random() * 100,
      opacity: Math.random() * 0.3,
      // Slower particle float (20s - 50s)
      duration: 15 + Math.random() * 20,
      delay: Math.random() * 10
    }));
  }, [seed]); // Also regenerate particles on seed change

  // Create spring-based scales for each band
  const useBandScale = (val: MotionValue<number> | undefined) => {
    // Fallback to main audioPower if band is missing
    const source = val || audioPower;
    const spring = useSpring(source, { stiffness: 300, damping: 30 });
    return useTransform(spring, [10, 200], [0.95, 1.45]);
  };

  const scales = {
    bass: useBandScale(audioBands?.bass),       // Circle
    lowMid: useBandScale(audioBands?.lowMid),   // Square
    mid: useBandScale(audioBands?.mid),         // Triangle
    vocal: useBandScale(audioBands?.vocal),     // Icon
    treble: useBandScale(audioBands?.treble),   // Cross
    default: useBandScale(audioPower)          // Fallback
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {shapes.map((shape) => {
        // Handle Icon rendering
        if (shape.type === 'icon' && shape.iconName) {
          // @ts-ignore - Dynamic access to Lucide icons
          const IconComponent = LucideIcons[shape.iconName];

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
                  color: theme.secondaryColor, // Use secondary color for stroke
                  scale: scales.vocal,
                }}
                animate={{
                  y: shape.reverse ? [-30, 30, -30] : [30, -30, 30],
                  x: shape.reverse ? [15, -15, 15] : [-15, 15, -15],
                  rotate: [shape.initialRotation, shape.initialRotation + 360], // Slow rotation starting from random angle
                  opacity: [0, shape.opacity * 3, 0], // Fade in and out
                }}
                transition={{
                  duration: shape.duration,
                  repeat: Infinity,
                  ease: "linear",
                  delay: shape.delay,
                  opacity: {
                    duration: shape.duration * 0.5, // Faster fade cycle than movement
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: shape.delay
                  }
                }}
              >
                <IconComponent size={shape.size} strokeWidth={1} absoluteStrokeWidth />
              </motion.div>
            );
          }
        }

        // Determine style based on shape type
        const isCircleOrSquare = shape.type === 'circle' || shape.type === 'square';
        // Use stroke if it's a circle/square AND NOT filled. 
        // If it's filled (randomly true for circle/square), or if it's other shapes (triangle/cross), use fill.
        const useStroke = isCircleOrSquare && !shape.filled;

        return (
          <motion.div
            key={shape.id}
            className="absolute"
            style={{
              left: `${shape.initialX}%`,
              top: `${shape.initialY}%`,
              width: shape.size,
              height: shape.size,
              border: useStroke ? `1px solid ${theme.secondaryColor}` : 'none',
              backgroundColor: !useStroke ? theme.secondaryColor : 'transparent',
              borderRadius: shape.type === 'circle' ? '50%' : '0%',
              opacity: shape.opacity,
              scale: shape.type === 'circle' ? scales.bass :
                shape.type === 'square' ? scales.lowMid :
                  shape.type === 'triangle' ? scales.mid :
                    shape.type === 'cross' ? scales.treble :
                      scales.default, // Fallback
              clipPath: shape.type === 'triangle'
                ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
                : shape.type === 'cross'
                  ? 'polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)'
                  : 'none',
            }}
            animate={{
              y: shape.reverse ? [-30, 30, -30] : [30, -30, 30],
              x: shape.reverse ? [15, -15, 15] : [-15, 15, -15],
              rotate: [shape.initialRotation, shape.initialRotation + 360],
              // scale: removed from here to allow audio control
            }}
            transition={{
              duration: shape.duration,
              repeat: Infinity,
              ease: "linear",
              delay: shape.delay
            }}
          />
        );
      })}

      {/* Floating particles/dust */}
      {particles.map((p) => (
        <motion.div
          key={`p-${p.id}`}
          className="absolute rounded-full"
          style={{
            backgroundColor: theme.accentColor,
            width: p.size,
            height: p.size,
            left: `${p.left}%`,
            top: `${p.top}%`,
            opacity: p.opacity
          }}
          animate={{
            y: [0, -100], // Move up slightly
            opacity: [0, p.opacity, 0] // Fade in and out
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            ease: "linear",
            delay: p.delay
          }}
        />
      ))}

      {/* Gradient overlay to soften edges - Stronger Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.6) 100%)' }}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Check seed change
  if (prevProps.seed !== nextProps.seed) return false;

  // Check audioPower stability
  if (prevProps.audioPower !== nextProps.audioPower) return false;

  // Check audioBands stability (compare individual MotionValues, not container object)
  const pBands = prevProps.audioBands;
  const nBands = nextProps.audioBands;

  // If one is missing and other isn't -> re-render
  if (!pBands !== !nBands) return false;

  // If both exist, compare all bands
  let bandsEqual = true;
  if (pBands && nBands) {
    bandsEqual =
      pBands.bass === nBands.bass &&
      pBands.lowMid === nBands.lowMid &&
      pBands.mid === nBands.mid &&
      pBands.vocal === nBands.vocal &&
      pBands.treble === nBands.treble;
  }
  if (!bandsEqual) return false;

  // Theme Update Check (Color Values)
  const pTheme = prevProps.theme;
  const nTheme = nextProps.theme;

  // Check basic colors logic
  const colorsEqual =
    pTheme.backgroundColor === nTheme.backgroundColor &&
    pTheme.primaryColor === nTheme.primaryColor &&
    pTheme.secondaryColor === nTheme.secondaryColor &&
    pTheme.accentColor === nTheme.accentColor;

  // Also check lyricsIcons if they affect rendering shape usage
  const iconsEqual =
    (pTheme.lyricsIcons === nTheme.lyricsIcons) ||
    (pTheme.lyricsIcons?.length === nTheme.lyricsIcons?.length &&
      pTheme.lyricsIcons?.every((val, index) => val === nTheme.lyricsIcons?.[index]));

  return colorsEqual && iconsEqual;
});

export default GeometricBackground;
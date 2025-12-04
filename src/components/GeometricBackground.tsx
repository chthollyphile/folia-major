import React, { useMemo } from 'react';
import { motion, MotionValue, useTransform, useSpring } from 'framer-motion';
import * as LucideIcons from 'lucide-react';
import { Theme } from '../types';

interface GeometricBackgroundProps {
  theme: Theme;
  audioPower: MotionValue<number>;
}

const GeometricBackground: React.FC<GeometricBackgroundProps> = React.memo(({ theme, audioPower }) => {
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
        // Icons move/fade faster (15s-30s), shapes move slower (30s-60s)
        duration: useIcon ? 15 + Math.random() * 15 : 30 + Math.random() * 30,
        delay: Math.random() * 5,
        opacity: 0.04 + Math.random() * 0.08, // Increased opacity for better visibility
        reverse: Math.random() > 0.5,
        // Randomly decide if circle/square should be filled (30% chance filled)
        filled: Math.random() < 0.3,
        initialRotation: Math.random() * 360
      };
    });
  }, [theme.lyricsIcons]); // Re-generate if icons change

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
  }, []);

  // Create a spring-based physics value from the raw audio power
  // This removes jitter and adds a nice "bounce" to the beat
  const springAudio = useSpring(audioPower, { stiffness: 300, damping: 30 }) as unknown as MotionValue<number>;

  // Map audio power (0-255 boosted) to a subtle scale factor
  // Lower threshold (10) allows it to pick up quieter bass
  // Upper range (200) caps the max expansion
  const scale = useTransform(springAudio, [10, 200], [0.95, 1.45]);

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
                  scale: scale,
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
              scale: scale, // Bind dynamic scale here
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
});

export default GeometricBackground;
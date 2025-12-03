import React, { useMemo, useRef, useEffect, useState } from 'react';
import { motion, MotionValue, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { Line, Theme, Word } from '../types';

interface VisualizerProps {
  currentTime: MotionValue<number>;
  currentLineIndex: number;
  lines: Line[];
  theme: Theme;
  audioPower: MotionValue<number>;
  showText?: boolean;
}

const LINE_SPACING = 30;
const VISIBLE_RANGE_BACK = 2;
const VISIBLE_RANGE_FORWARD = 6;

const Visualizer3D: React.FC<VisualizerProps> = ({
  currentTime,
  currentLineIndex,
  lines,
  theme,
  audioPower,
  showText = true,
}) => {
  const { t } = useTranslation();
  const [timeValue, setTimeValue] = useState(0);
  const [audioPowerValue, setAudioPowerValue] = useState(0);

  useMotionValueEvent(currentTime, 'change', (value) => setTimeValue(value));
  useMotionValueEvent(audioPower, 'change', (value) => setAudioPowerValue(value));

  return (
    <div
      className="w-full h-full relative"
      style={{ backgroundColor: theme.backgroundColor, transition: 'background-color 1s ease' }}
    >
      <Canvas camera={{ position: [0, 0, 10], fov: 60, far: 1000 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
        <SceneContent
          currentTime={timeValue}
          currentLineIndex={currentLineIndex}
          lines={lines}
          theme={theme}
          audioPower={audioPowerValue}
          showText={showText}
        />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
      </Canvas>

      {showText && lines[currentLineIndex]?.translation && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          key={`trans-${lines[currentLineIndex].startTime}`}
          className="absolute bottom-32 w-full text-center px-8 z-20 pointer-events-none"
        >
          <p
            className="text-lg md:text-xl font-medium max-w-4xl mx-auto drop-shadow-md bg-black/30 backdrop-blur-sm rounded-xl py-2 px-4 inline-block"
            style={{ color: theme.secondaryColor }}
          >
            {lines[currentLineIndex].translation}
          </p>
        </motion.div>
      )}

      {showText && lines.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: theme.secondaryColor }}
        >
          <span className="opacity-50">{t('ui.waitingForMusic')}</span>
        </div>
      )}
    </div>
  );
};

const SceneContent: React.FC<{
  currentTime: number;
  currentLineIndex: number;
  lines: Line[];
  theme: Theme;
  audioPower: number;
  showText: boolean;
}> = ({ currentTime, currentLineIndex, lines, theme, audioPower, showText }) => {
  const { camera, scene } = useThree();
  const targetZRef = useRef(10);

  useFrame((state, delta) => {
    const targetZ = -(currentLineIndex * LINE_SPACING) + 12; // Closer camera (was 20)

    if (currentLineIndex === -1) {
      targetZRef.current = 20;
    } else {
      targetZRef.current = targetZ;
    }

    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZRef.current, delta * 1.5);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, state.mouse.x * 3, delta);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, state.mouse.y * 3, delta);

    if (scene.fog) {
      scene.fog.color.set(theme.backgroundColor);
    }
  });

  useEffect(() => {
    scene.fog = new THREE.FogExp2(theme.backgroundColor, 0.008);
  }, [theme.backgroundColor, scene]);

  const startIndex = Math.max(0, currentLineIndex - VISIBLE_RANGE_BACK);
  const endIndex = Math.min(lines.length - 1, currentLineIndex + VISIBLE_RANGE_FORWARD);
  const visibleLines = [];

  if (showText) {
    for (let i = startIndex; i <= endIndex; i++) {
      if (lines[i]) {
        visibleLines.push({ ...lines[i], index: i });
      }
    }
  }

  return (
    <>
      <BackgroundParticles theme={theme} audioPower={audioPower} />
      {visibleLines.map((line: any) => (
        <LyricLineGroup
          key={`${line.startTime}-${line.index}`}
          line={line}
          index={line.index}
          currentTime={currentTime}
          theme={theme}
          isCurrent={line.index === currentLineIndex}
        />
      ))}
    </>
  );
};

const LyricLineGroup: React.FC<{
  line: Line;
  index: number;
  currentTime: number;
  theme: Theme;
  isCurrent: boolean;
}> = ({ line, index, currentTime, theme, isCurrent }) => {
  const layout = useMemo(() => {
    const seed = index * 123.45;
    const isChaotic = theme.animationIntensity === 'chaotic';
    const isCalm = theme.animationIntensity === 'calm';

    const xNoise = Math.sin(seed) * (isChaotic ? 15 : isCalm ? 2 : 5);
    const yNoise = Math.cos(seed * 0.5) * (isChaotic ? 10 : isCalm ? 1 : 3);
    const zPos = -(index * LINE_SPACING);
    const rotZ = isChaotic ? (Math.random() - 0.5) * 20 : 0;

    return {
      position: [xNoise, yNoise, zPos] as [number, number, number],
      rotation: [0, 0, rotZ] as [number, number, number],
    };
  }, [index, theme.animationIntensity]);

  return (
    <group position={layout.position} rotation={layout.rotation}>
      <LyricLineText line={line} currentTime={currentTime} theme={theme} isCurrent={isCurrent} />
    </group>
  );
};

const LyricLineText: React.FC<{
  line: Line;
  currentTime: number;
  theme: Theme;
  isCurrent: boolean;
}> = ({ line, currentTime, theme, isCurrent }) => {
  const wordsWithLayout = useMemo(() => {
    const seed = line.startTime;
    const isChaotic = theme.animationIntensity === 'chaotic';
    const isCalm = theme.animationIntensity === 'calm';
    const MAX_LINE_WIDTH = 18; // Maximum width before wrapping

    // Pseudo-random generator
    const random = (offset: number) => {
      const x = Math.sin(seed + offset) * 10000;
      return x - Math.floor(x);
    };

    let currentX = 0;
    let currentY = 0;
    let lineStartIndex = 0;
    let maxRowWidth = 0;
    const processed: any[] = [];

    // First pass: calculate positions with wrapping
    line.words.forEach((w, i) => {
      const size = isCurrent ? 1.5 : 1;
      const charWidth = size * 0.6;
      const width = w.text.length * charWidth;
      const margin = isCalm ? 0.2 : 0.5;

      // Check if we need to wrap
      // Wrap if not the first word and adding this word would exceed max width
      if (currentX + width > MAX_LINE_WIDTH && currentX > 0) {
        // Wrap to next line
        currentX = 0;
        currentY -= 2.5; // Move down
        lineStartIndex = i;
      }

      let x = currentX;
      let y = currentY;
      let rotZ = 0;

      if (isChaotic) {
        const baseSpread = 15;
        const baseRotate = 0.5;
        // In chaotic mode, we still respect the general "block" but scatter within it
        x += (random(i * 10 + 1) - 0.5) * 2; // Reduced scatter for readability
        y += (random(i * 10 + 2) - 0.5) * 1;
        rotZ = (random(i * 10 + 3) - 0.5) * baseRotate;
      } else {
        // Linear layout
        currentX += width + margin;

        if (!isCalm) {
          // Standard mode: add slight randomness
          y += (random(i * 10 + 4) - 0.5) * 0.5; // Slight vertical offset
          rotZ = (random(i * 10 + 5) - 0.5) * 0.1; // Slight rotation
        }
      }

      processed.push({ ...w, x, y, rotZ, width, rowIndex: currentY });
      maxRowWidth = Math.max(maxRowWidth, currentX);
    });

    // Second pass: Center the entire block
    // We need to find the bounding box of the block
    if (!isChaotic && processed.length > 0) {
      const rows: Record<number, any[]> = {};
      processed.forEach(p => {
        if (!rows[p.rowIndex]) rows[p.rowIndex] = [];
        rows[p.rowIndex].push(p);
      });

      Object.values(rows).forEach(rowWords => {
        if (rowWords.length === 0) return;
        const lastWord = rowWords[rowWords.length - 1];
        const rowWidth = lastWord.x + lastWord.width;
        const centerOffset = rowWidth / 2;

        rowWords.forEach(w => {
          w.x -= centerOffset;
        });
      });

      // Also center vertically
      const totalHeight = Math.abs(currentY);
      const verticalOffset = totalHeight / 2;
      processed.forEach(w => {
        w.y += verticalOffset;
      });
    }

    return processed;
  }, [line, isCurrent, theme.animationIntensity]);

  return (
    <>
      {wordsWithLayout.map((w, i) => (
        <LyricWord
          key={`${w.text}-${i}`}
          word={w}
          x={w.x}
          currentTime={currentTime}
          theme={theme}
          isLineCurrent={isCurrent}
          baseY={w.y}
          baseRotZ={w.rotZ}
        />
      ))}
    </>
  );
};

const LyricWord: React.FC<{
  word: Word;
  x: number;
  currentTime: number;
  theme: Theme;
  isLineCurrent: boolean;
  baseY?: number;
  baseRotZ?: number;
}> = ({ word, x, currentTime, theme, isLineCurrent, baseY = 0, baseRotZ = 0 }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  // Store current animated values to avoid re-creating objects
  const animState = useRef({
    opacity: 0,
    scale: 0.5,
    x: x,
    y: baseY,
    z: 0,
    rotZ: baseRotZ,
    color: new THREE.Color(theme.primaryColor),
  });

  // Random offsets for "waiting" state
  const randomOffsets = useMemo(() => {
    const seed = x * 123.45;
    return {
      x: (Math.sin(seed) - 0.5) * 5,
      y: (Math.cos(seed) - 0.5) * 5,
      rotZ: (Math.sin(seed * 2) - 0.5) * 0.5,
    };
  }, [x]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const PRE_LOOKAHEAD = 0.15;
    let targetState = {
      opacity: 0,
      scale: 0.5,
      x: x + randomOffsets.x,
      y: baseY + randomOffsets.y,
      z: 0,
      rotZ: baseRotZ + randomOffsets.rotZ + 0.5, // Add some extra rotation
      color: new THREE.Color(theme.primaryColor),
    };

    // Determine status
    if (currentTime >= word.startTime - PRE_LOOKAHEAD && currentTime <= word.endTime) {
      // ACTIVE
      let activeColor = theme.accentColor;
      if (theme.wordColors) {
        const cleanText = word.text.trim().toLowerCase().replace(/[^\w]/g, '');
        const match = theme.wordColors.find((wc) => {
          const target = wc.word.toLowerCase().replace(/[^\w]/g, '');
          return target.includes(cleanText) || cleanText.includes(target);
        });
        if (match) activeColor = match.color;
      }

      targetState = {
        opacity: 1,
        scale: isLineCurrent ? 1.5 : 1.3,
        x: x,
        y: baseY,
        z: 0,
        rotZ: baseRotZ,
        color: new THREE.Color(activeColor),
      };
    } else if (currentTime > word.endTime) {
      // PASSED
      targetState = {
        opacity: theme.animationIntensity === 'chaotic' ? 0.6 : 0.4,
        scale: 1,
        x: x,
        y: baseY,
        z: 0,
        rotZ: baseRotZ, // Could add passedRotate logic here if needed
        color: new THREE.Color(theme.primaryColor),
      };
    } else {
      // WAITING (default)
      targetState.color = new THREE.Color(theme.primaryColor);
    }

    // Interpolation
    const lerpFactor = delta * 5; // Adjust speed
    const colorLerpFactor = delta * 8;

    animState.current.opacity = THREE.MathUtils.lerp(animState.current.opacity, targetState.opacity, lerpFactor);
    animState.current.scale = THREE.MathUtils.lerp(animState.current.scale, targetState.scale, lerpFactor);
    animState.current.x = THREE.MathUtils.lerp(animState.current.x, targetState.x, lerpFactor);
    animState.current.y = THREE.MathUtils.lerp(animState.current.y, targetState.y, lerpFactor);
    animState.current.rotZ = THREE.MathUtils.lerp(animState.current.rotZ, targetState.rotZ, lerpFactor);

    animState.current.color.lerp(targetState.color, colorLerpFactor);

    // Apply to mesh
    meshRef.current.position.set(animState.current.x, animState.current.y, animState.current.z);
    meshRef.current.rotation.z = animState.current.rotZ;
    meshRef.current.scale.setScalar(animState.current.scale);

    // Apply color and opacity
    // @ts-ignore - Troika text instance has color and fillOpacity properties
    if (meshRef.current.color !== undefined) {
      // @ts-ignore
      meshRef.current.color = animState.current.color;
    } else if (meshRef.current.material) {
      // Fallback for standard meshes
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.color = animState.current.color;
      }
    }

    // @ts-ignore
    if (meshRef.current.fillOpacity !== undefined) {
      // @ts-ignore
      meshRef.current.fillOpacity = animState.current.opacity;
    } else if (meshRef.current.material) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = animState.current.opacity;
        mat.transparent = true;
      }
    }
  });

  return (
    <Text
      ref={meshRef}
      position={[x, baseY, 0]} // Initial position, will be overridden by useFrame
      fontSize={1.2}
      anchorX="left"
      anchorY="middle"
    // We set initial values here, but useFrame will take over
    >
      {word.text}
    </Text>
  );
};

const BackgroundParticles: React.FC<{ theme: Theme; audioPower: number }> = ({ theme, audioPower }) => {
  const particles = useMemo(
    () =>
      new Array(60).fill(0).map((_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 100, // Wider spread
        y: (Math.random() - 0.5) * 80,
        zOffset: Math.random() * 100, // Relative offset
        size: Math.random() * 2 + 0.5, // Larger particles
        type: Math.random() > 0.6 ? 'box' : 'dodec',
      })),
    [],
  );

  return (
    <group>
      {particles.map((p) => (
        <FloatingParticle key={p.id} data={p} theme={theme} audioPower={audioPower} />
      ))}
    </group>
  );
};

const FloatingParticle: React.FC<{ data: any; theme: Theme; audioPower: number }> = ({ data, theme, audioPower }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    meshRef.current.rotation.x += delta * 0.5;
    meshRef.current.rotation.y += delta * 0.3;

    // Keep particles around the camera
    const range = 100;
    const zPos = (camera.position.z - 50) + ((data.zOffset + camera.position.z * 0.5) % range);

    meshRef.current.position.z = zPos;

    // Fade out based on distance from camera focus
    const dist = Math.abs(zPos - (camera.position.z - 20));
    let opacity = 0.3;
    if (dist > 40) {
      opacity = 0.3 * (1 - (dist - 40) / 20);
    }
    if (opacity < 0) opacity = 0;

    const pulse = 0.9 + (audioPower / 255) * 0.8;
    meshRef.current.scale.setScalar(pulse);

    if (!Array.isArray(meshRef.current.material)) {
      (meshRef.current.material as THREE.Material & { opacity?: number }).opacity = opacity;
    }
  });

  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={2}>
      <mesh ref={meshRef} position={[data.x, data.y, 0]}>
        {data.type === 'box' ? <boxGeometry args={[data.size, data.size, data.size]} /> : <dodecahedronGeometry args={[data.size, 0]} />}
        <meshBasicMaterial color={theme.secondaryColor} transparent opacity={0.2} wireframe />
      </mesh>
    </Float>
  );
};

export default Visualizer3D;


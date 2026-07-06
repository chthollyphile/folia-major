import React, { useEffect, useRef } from 'react';
import * as twgl from 'twgl.js';
import { Theme } from '../../types';
import { parseColorChannels } from './colorMix';

// SoraBackground component is a shader-based space starfield background.
// Refactored to use GL_POINTS for massive performance gains, resolving blur CPU usage issues.

interface SoraBackgroundProps {
  theme: Theme;
  isDaylight: boolean;
  paused?: boolean;
}

const PARTICLE_COUNT = 150;

const VERTEX_SHADER = `
attribute float a_index;
uniform vec2 u_resolution;
uniform float u_time;
varying float v_color_type;
varying float v_intensity_base;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float seed = a_index * 123.456;
  
  float speed_rand = hash2(vec2(seed, 1.1));
  float size_rand = hash2(vec2(seed, 2.2));
  float y_rand = hash2(vec2(seed, 3.3));
  float x_rand = hash2(vec2(seed, 4.4));
  float blink_rand = hash2(vec2(seed, 5.5));
  float color_type_rand = hash2(vec2(seed, 6.6));

  float aspect = u_resolution.x / u_resolution.y;
  float speed = 0.008 + speed_rand * 0.024;
  float size = 0.0006 + 0.0032 * pow(size_rand, 3.8);
  
  float y = -0.45 + y_rand * 0.9;
  
  float margin = 0.05;
  float width = aspect + margin * 2.0;
  float x = fract(x_rand + u_time * speed);
  x = x * width - (aspect * 0.5 + margin);
  
  float wave = sin(u_time * 0.3 + y_rand * 6.283) * 0.005;
  
  float ndc_x = x / (aspect * 0.5);
  float ndc_y = (y + wave) / 0.5;
  
  gl_Position = vec4(ndc_x, ndc_y, 0.0, 1.0);
  
  // Point size in pixels. 
  float pointSize = size * u_resolution.y * 3.5;
  gl_PointSize = max(2.0, pointSize);
  
  float blink = 0.3 + 0.7 * sin(u_time * (1.0 + blink_rand * 2.5) + x_rand * 6.283);
  v_intensity_base = blink;
  v_color_type = color_type_rand;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 u_particle_color;
uniform vec3 u_particle_accent_color;

varying float v_color_type;
varying float v_intensity_base;

void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float dist = length(pc);
  
  float alpha = smoothstep(0.5, 0.1, dist) * v_intensity_base;
  if (alpha < 0.01) discard;
  
  vec3 baseColor = v_color_type > 0.90 ? u_particle_accent_color : u_particle_color;
  
  // Pre-multiplied alpha blending
  gl_FragColor = vec4(baseColor * alpha, alpha);
}
`;

const SoraBackground: React.FC<SoraBackgroundProps> = ({ theme, isDaylight, paused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef<number>(0);

  const primaryColorChannels = parseColorChannels(theme.primaryColor) || 
    (isDaylight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 });
  const particleColor = [
    primaryColorChannels.r / 255,
    primaryColorChannels.g / 255,
    primaryColorChannels.b / 255,
  ];
  
  const accentColorChannels = parseColorChannels(theme.accentColor) || primaryColorChannels;
  const particleAccentColor = [
    accentColorChannels.r / 255,
    accentColorChannels.g / 255,
    accentColorChannels.b / 255,
  ];

  const bgColor = isDaylight ? [1.0, 1.0, 1.0] : [0.0, 0.0, 0.0];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = twgl.getContext(canvas, { alpha: false, depth: false, antialias: false });
    if (!gl) return;

    const programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER], (err) => {
      console.error("SoraBackground twgl program error:", err);
    });
    if (!programInfo) return;
    
    // Create an array of particle indices
    const indices = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      indices[i] = i;
    }
    
    const arrays = {
      a_index: { numComponents: 1, data: indices }
    };
    const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays);

    let lastTimestamp = performance.now();

    const render = (now: number) => {
      if (!paused) {
        const delta = (now - lastTimestamp) / 1000;
        timeRef.current += delta;
      }
      lastTimestamp = now;

      twgl.resizeCanvasToDisplaySize(canvas);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

      // Clear background
      gl.clearColor(bgColor[0], bgColor[1], bgColor[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Enable additive blending
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const uniforms = {
        u_resolution: [gl.canvas.width, gl.canvas.height],
        u_time: timeRef.current,
        u_particle_color: particleColor,
        u_particle_accent_color: particleAccentColor,
      };

      gl.useProgram(programInfo.program);
      twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
      twgl.setUniforms(programInfo, uniforms);
      
      twgl.drawBufferInfo(gl, bufferInfo, gl.POINTS);

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      gl.deleteProgram(programInfo.program);
      if (bufferInfo.attribs && bufferInfo.attribs.a_index && bufferInfo.attribs.a_index.buffer) {
          gl.deleteBuffer(bufferInfo.attribs.a_index.buffer);
      }
    };
  }, [
    paused, 
    particleColor[0], particleColor[1], particleColor[2], 
    particleAccentColor[0], particleAccentColor[1], particleAccentColor[2], 
    bgColor[0], bgColor[1], bgColor[2]
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block pointer-events-none"
      style={{
        width: '100%',
        height: '100%',
        willChange: 'transform',
        transform: 'translateZ(0)',
      }}
    />
  );
};

export default SoraBackground;

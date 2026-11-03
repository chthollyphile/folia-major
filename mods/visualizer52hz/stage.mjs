// mods/visualizer52hz/stage.mjs
// The 52Hz stage: the current lyric line appears in the middle and lights up
// character by character, and a ring leaves its glyph outlines on every beat,
// spreading outward like a tree ring that records how loud that beat was.
// A song without lyrics grows its rings from random piths instead.
//
// Everything is keyed to the lyric clock (ctx.lyricTime), not the wall clock:
// pausing freezes the rings, seeking back clears the record, and the export
// window, which steps the clock itself, renders the same picture.

import * as PIXI from './vendor/pixi.min.mjs';
import { layoutLine, buildLineField } from './lineLayout.mjs';
import { buildPithField } from './pithShape.mjs';
import { createLyricText } from './lyricText.mjs';
import { hashString } from './random.mjs';
import { createBeatDetector } from './beatDetector.mjs';
import {
  SLOT_COUNT,
  HISTORY_SIZE,
  HISTORY_RATE,
  FAR_FROM_BEAT,
  createFieldSource,
  createHistorySource,
  createRippleFilter,
} from './rippleFilter.mjs';

// Same reasoning as the host's loadPixi: mediump is real fp16 on some drivers,
// and song-time math in the shader needs fp32.
PIXI.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp';

const TARGET_GRID = 480;          // field cells across the longer side
const OPEN_WINDOW_END = 1e9;
const UNUSED_WINDOW = [1, 0];
// The song clock moving this much (s) more or less than the wall clock between two
// frames is a seek, not playback: the ring record restarts. Comparing the two keeps
// a stalled frame (the clock and the wall both moved on) from wiping the record.
const SEEK_JUMP_SEC = 0.5;
const ENERGY_FLOOR = 0.06;        // silence still leaves faint growth lines
const PITH_PERIOD_SEC = 11;       // an instrumental grows from a new pith this often
// How far back a beat marks the samples before it (their distance to the coming ring).
const BEAT_LOOKBACK_SAMPLES = Math.round(0.5 * HISTORY_RATE);
const STATIC_BEAT_SEC = 0.72;     // ring cadence of a static preview

const colorProbe = document.createElement('canvas').getContext('2d');
/** Any CSS color -> [r, g, b] in 0..1. */
const toRgb = (color, fallback) => {
  colorProbe.fillStyle = fallback;
  colorProbe.fillStyle = color || fallback;
  const value = colorProbe.fillStyle;
  if (value.startsWith('#')) {
    return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  }
  const parts = value.match(/[\d.]+/g) ?? ['255', '255', '255'];
  return parts.slice(0, 3).map((part) => Number(part) / 255);
};

/*
 * Audio -> a 0..1 "growth" value per frame. Loudness is divided by a slowly
 * decaying peak so quiet and loud masters both use the full range, then an
 * envelope with a fast attack and slow release gives beats a clear ring.
 */
const createEnergyFollower = () => {
  let peak = 0.2;
  let envelope = 0;
  return {
    reset() {
      envelope = 0;
    },
    step(audio, sensitivity, dt) {
      if (!audio) return ENERGY_FLOOR;
      const bands = audio.getBands();
      const raw = 0.6 * audio.getPower() + 0.4 * bands.bass;
      peak = Math.max(raw, peak * Math.exp(-dt / 8), 0.08);
      const target = Math.min(1, (raw / peak) * sensitivity);
      const rate = target > envelope ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.35);
      envelope += (target - envelope) * rate;
      return ENERGY_FLOOR + (1 - ENERGY_FLOOR) * envelope;
    },
  };
};

export const mount52Hz = (folium, container, ctx) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  container.appendChild(host);

  let disposed = false;
  let cleanup = () => {};

  const start = async () => {
    const app = new PIXI.Application();
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      backgroundAlpha: 0,
      antialias: false,
      preference: 'webgl',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
    });
    if (disposed) {
      app.destroy(true, { children: true, texture: true });
      return;
    }
    app.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    host.appendChild(app.canvas);

    // ---- stage geometry and GPU resources (rebuilt on resize) ----
    let width = 1;
    let height = 1;
    let cell = 4;
    let gridWidth = 1;
    let gridHeight = 1;
    let fieldSources = [];
    // Two strips over song time: growth energy, and seconds to the nearest beat (ring birth).
    const historySource = createHistorySource(PIXI);
    const historyData = historySource.resource;
    const beatSource = createHistorySource(PIXI);
    const beatData = beatSource.resource;
    beatData.fill(FAR_FROM_BEAT);
    const cellOf = (index) => ((index % HISTORY_SIZE) + HISTORY_SIZE) % HISTORY_SIZE;

    const ringSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    const textLayer = new PIXI.Container();
    app.stage.addChild(ringSprite, textLayer);
    const text = createLyricText(PIXI, textLayer);

    let ring = null;

    /*
     * Ring sources. A source is what rings grow from: a lyric line
     * `{ key, kind: 'line', lineIndex }` or a pith `{ key, kind: 'pith', seed }`.
     * Each slot holds one source's field and the song-time window it emitted in.
     */
    const slots = Array.from({ length: SLOT_COUNT }, () => ({ source: null, start: 1, end: 0 }));
    let openSlot = -1;
    let shownKey;                     // key of the source last switched to (null: none)

    // ---- ring record ----
    const follower = createEnergyFollower();
    const beats = createBeatDetector();
    let lastBeatTime = -Infinity;
    let historyStart = 0;
    let lastSampleIndex = null;
    let lastTime = null;
    let lastWall = null;

    const settings = () => ctx.getSettings();
    // The user's lyric size scales on top of the mod's own size setting, as in builtin modes.
    const fontScale = () => Number(settings().fontScale ?? 1) * ctx.getDisplay().lyricsFontScale;
    // Resolved the way builtin modes resolve the theme font.
    const lyricFont = () => {
      const theme = ctx.getTheme();
      return { family: folium.theme.resolveFontStack(theme), weight: folium.theme.resolveFontWeight(theme, 500) };
    };
    const hasLyrics = ctx.lines.some((line) => line.fullText.trim());
    const songSeed = hashString(`${ctx.song?.title ?? ''}|${ctx.song?.artist ?? ''}`);

    const layoutFor = (lineIndex) => {
      const line = ctx.lines[lineIndex];
      if (!line || !line.fullText.trim()) return null;
      return layoutLine(line.fullText, lyricFont(), width, height, fontScale());
    };

    const sourceAt = (time) => {
      if (!hasLyrics) {
        const period = Math.floor(time / PITH_PERIOD_SEC);
        return { key: `pith:${period}`, kind: 'pith', seed: (songSeed ^ Math.imul(period + 1, 0x9e3779b1)) >>> 0 };
      }
      const lineIndex = ctx.staticMode && ctx.staticLineIndex !== null ? ctx.staticLineIndex : ctx.getLineIndex();
      if (!ctx.lines[lineIndex]?.fullText.trim()) return null;
      return { key: `line:${lineIndex}`, kind: 'line', lineIndex };
    };

    const buildField = (source) => {
      if (source?.kind === 'line') {
        const layout = layoutFor(source.lineIndex);
        return layout ? buildLineField(layout, cell, gridWidth, gridHeight) : null;
      }
      if (source?.kind === 'pith') return buildPithField(source.seed, width, height, cell, gridWidth, gridHeight);
      return null;
    };

    const fillSlotField = (slotIndex) => {
      const target = fieldSources[slotIndex];
      const field = buildField(slots[slotIndex].source);
      if (field) target.resource = field;
      else target.resource.fill(1e6);
      target.update();
    };

    const applyWindows = () => {
      slots.forEach((slot, index) => {
        const range = ring.uniforms[`uWindow${index}`];
        const used = slot.source !== null && slot.end >= slot.start;
        range[0] = used ? slot.start : UNUSED_WINDOW[0];
        range[1] = used ? slot.end : UNUSED_WINDOW[1];
      });
    };

    const showLineText = (lineIndex, time) => {
      const layout = layoutFor(lineIndex);
      if (layout) text.show(ctx.lines[lineIndex], lineIndex, layout, ctx.getTheme(), app.renderer.resolution, time);
    };

    // Starts emitting rings from `source` (or stops, for null) at song time `time`.
    const switchSource = (source, time) => {
      shownKey = source?.key ?? null;
      if (openSlot >= 0) {
        slots[openSlot].end = time;
        openSlot = -1;
      }
      text.hide(time);
      if (!source) return;

      // Reuse a free slot, else the one that stopped emitting longest ago.
      let target = slots.findIndex((slot) => slot.source === null);
      if (target < 0) {
        target = slots.reduce((oldest, slot, index) => (slot.end < slots[oldest].end ? index : oldest), 0);
      }
      slots[target].source = source;
      // A static preview has no playback: its one source has always been emitting.
      slots[target].start = ctx.staticMode ? -1e9 : time;
      slots[target].end = OPEN_WINDOW_END;
      openSlot = target;
      fillSlotField(target);
      if (source.kind === 'line') showLineText(source.lineIndex, time);
    };

    // After a seek the old record no longer describes the past: start over at `time`, keeping
    // only the source on screen (re-emitting from now) and fading its text in again.
    const resetRecord = (time) => {
      historyData.fill(0);
      historySource.update();
      beatData.fill(FAR_FROM_BEAT);
      beatSource.update();
      historyStart = time;
      lastSampleIndex = Math.floor(time * HISTORY_RATE);
      follower.reset();
      beats.reset();
      lastBeatTime = -Infinity;
      slots.forEach((slot, index) => {
        if (index === openSlot) {
          slot.start = time;
        } else {
          slot.source = null;
          slot.start = UNUSED_WINDOW[0];
          slot.end = UNUSED_WINDOW[1];
        }
      });
      text.restart(time);
      applyWindows();
      dirty = true;
    };

    // A static preview has no playback to record; give it a plausible past.
    const seedStaticRecord = () => {
      for (let i = 0; i < HISTORY_SIZE; i += 1) {
        historyData[i] = 0.2 + 0.45 * (0.5 + 0.5 * Math.sin(i * 0.13)) * (0.5 + 0.5 * Math.sin(i * 0.031));
        const beatPhase = i / HISTORY_RATE / STATIC_BEAT_SEC;
        beatData[i] = Math.abs(beatPhase - Math.round(beatPhase)) * STATIC_BEAT_SEC;
      }
      historySource.update();
      beatSource.update();
      historyStart = -1e9;
    };

    const rebuildGeometry = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      app.renderer.resize(width, height);
      cell = Math.max(2, Math.max(width, height) / TARGET_GRID);
      gridWidth = Math.ceil(width / cell);
      gridHeight = Math.ceil(height / cell);

      const previousFilter = ring?.filter;
      fieldSources.forEach((source) => source.destroy());
      fieldSources = Array.from({ length: SLOT_COUNT }, () => createFieldSource(PIXI, gridWidth, gridHeight));
      ring = createRippleFilter(PIXI, { fieldSources, historySource, beatSource });
      ringSprite.filters = [ring.filter];
      previousFilter?.destroy();
      ringSprite.width = width;
      ringSprite.height = height;
      ring.uniforms.uScreen[0] = width;
      ring.uniforms.uScreen[1] = height;
      ring.uniforms.uCell = cell;

      slots.forEach((_, index) => fillSlotField(index));
      applyWindows();

      const lineIndex = text.lineIndex;
      const layout = lineIndex >= 0 ? layoutFor(lineIndex) : null;
      if (layout) text.rebuild(ctx.lines[lineIndex], layout, ctx.getTheme(), app.renderer.resolution);
      dirty = true;
    };

    const applyLook = () => {
      const theme = ctx.getTheme();
      const values = settings();
      const halfDiagonal = Math.hypot(width, height) / 2;
      // At speed 1 a ring takes ~10 s to reach the screen edge, where it has faded out.
      ring.uniforms.uSpeed = (halfDiagonal / 10) * Number(values.reach ?? 1);
      ring.uniforms.uFadeDistance = halfDiagonal;
      ring.uniforms.uOpacity = Number(values.opacity ?? 0.8);
      ring.uniforms.uColorNear.set(toRgb(theme.accentColor, theme.isDaylight ? '#000' : '#fff'));
      ring.uniforms.uColorFar.set(toRgb(theme.primaryColor, theme.isDaylight ? '#000' : '#fff'));
    };

    /*
     * Writes every history cell the clock moved past: the growth value, and how
     * long after the last beat it is. A beat then marks itself (0) and tells the
     * cells just before it how far ahead it came, so each ring has both edges.
     */
    const recordAudio = (time, wall) => {
      const dt = lastTime === null ? 0 : time - lastTime;
      const wallDt = lastWall === null ? 0 : (wall - lastWall) / 1000;
      const jumped = lastTime === null || dt < -1e-3 || Math.abs(dt - wallDt) > SEEK_JUMP_SEC;
      if (jumped) {
        resetRecord(time);
        return;
      }
      const sampleIndex = Math.floor(time * HISTORY_RATE);
      if (sampleIndex === lastSampleIndex) return;
      const values = settings();
      const value = follower.step(ctx.audio, Number(values.sensitivity ?? 1), dt);
      // A long stall (or a long pause of rendering) fills at most one full record.
      const first = Math.max(lastSampleIndex + 1, sampleIndex - HISTORY_SIZE + 1);
      for (let index = first; index <= sampleIndex; index += 1) {
        historyData[cellOf(index)] = value;
        beatData[cellOf(index)] = Math.min(FAR_FROM_BEAT, index / HISTORY_RATE - lastBeatTime);
      }
      if (beats.step(ctx.audio, time, dt, Number(values.beatSensitivity ?? 1))) {
        lastBeatTime = sampleIndex / HISTORY_RATE;
        const oldest = Math.max(sampleIndex - BEAT_LOOKBACK_SAMPLES, Math.ceil(historyStart * HISTORY_RATE));
        for (let index = sampleIndex; index >= oldest; index -= 1) {
          const cell = cellOf(index);
          beatData[cell] = Math.min(beatData[cell], (sampleIndex - index) / HISTORY_RATE);
        }
      }
      lastSampleIndex = sampleIndex;
      historySource.update();
      beatSource.update();
    };

    let dirty = true;
    let renderedTime = null;

    const tick = () => {
      const time = ctx.lyricTime.get();
      if (!ctx.staticMode) {
        const wall = performance.now();
        recordAudio(time, wall);
        lastTime = time;
        lastWall = wall;
      }
      const source = sourceAt(time);
      if ((source?.key ?? null) !== shownKey) {
        switchSource(source, time);
        applyWindows();
        dirty = true;
      }
      // Paused: the clock stands still and nothing needs repainting.
      if (!dirty && time === renderedTime) return;
      const fading = text.update(time, ctx.staticMode);
      ring.uniforms.uTime = time;
      ring.uniforms.uHistoryStart = historyStart;
      app.render();
      renderedTime = time;
      dirty = fading;
    };

    rebuildGeometry();
    applyLook();
    if (ctx.staticMode) seedStaticRecord();

    // Font, glyph colors or font scale need the glyphs redrawn; the rest is uniforms.
    const glyphKey = () => {
      const theme = ctx.getTheme();
      const font = lyricFont();
      return `${font.family}|${font.weight}|${theme.primaryColor}|${theme.accentColor}|${fontScale()}`;
    };
    let lastGlyphKey = glyphKey();
    // The host stops these three when the mount ends.
    ctx.onChange(() => {
      const key = glyphKey();
      if (key !== lastGlyphKey) {
        lastGlyphKey = key;
        rebuildGeometry();
      }
      applyLook();
      dirty = true;
    });
    ctx.onResize(() => {
      if (host.clientWidth !== width || host.clientHeight !== height) {
        rebuildGeometry();
        applyLook();
      }
    });
    ctx.onFrame(tick);

    cleanup = () => {
      text.destroy();
      fieldSources.forEach((source) => source.destroy());
      historySource.destroy();
      beatSource.destroy();
      app.destroy(true, { children: true, texture: true });
    };
  };

  start().catch((error) => {
    console.error('[52Hz] failed to start', error);
  });

  return () => {
    disposed = true;
    cleanup();
    host.remove();
  };
};

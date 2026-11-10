import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/wallpaperDisplay.test.ts
// The display the user chose for wallpaper mode: which connected display a stored choice points
// at, when a running wallpaper has to move, and what counts as a stored choice at all. All of it
// is plain data in and out, so none of this needs Electron or a real display.

const require = createRequire(import.meta.url);
const {
  describeWallpaperDisplays,
  normalizeWallpaperDisplayChoice,
  resolveWallpaperDisplay,
  shouldMoveWallpaper,
} = require('../../../electron/wallpaper/wallpaperDisplay.cjs') as {
  describeWallpaperDisplays: (input: { displays: FakeDisplay[]; primaryId: number; choice: Choice | null; active: FakeDisplay | null }) => {
    displays: Array<{ id: number; label: string; bounds: Bounds; scaleFactor: number; primary: boolean }>;
    choice: Choice | null;
    chosenId: number | null;
    activeId: number | null;
  };
  normalizeWallpaperDisplayChoice: (value: unknown) => Choice | null;
  resolveWallpaperDisplay: (displays: FakeDisplay[], choice: Choice | null) => FakeDisplay | null;
  shouldMoveWallpaper: (displays: FakeDisplay[], choice: Choice | null, current: { id: number; bounds: Bounds } | null) => boolean;
};

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FakeDisplay {
  id: number;
  bounds: Bounds;
  scaleFactor: number;
  label: string;
}

interface Choice {
  id: number;
  bounds: Bounds;
  label: string;
}

const LEFT: FakeDisplay = { id: 11, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, label: 'Left' };
const RIGHT: FakeDisplay = { id: 22, bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25, label: 'Right' };

const choiceOf = (display: FakeDisplay): Choice => ({ id: display.id, bounds: { ...display.bounds }, label: display.label });

describe('resolveWallpaperDisplay', () => {
  it('gives the chosen display while it is connected, by id even after its geometry changed', () => {
    const resized: FakeDisplay = { ...RIGHT, bounds: { x: 2560, y: 0, width: 1280, height: 720 } };

    expect(resolveWallpaperDisplay([LEFT, RIGHT], choiceOf(RIGHT))).toBe(RIGHT);
    expect(resolveWallpaperDisplay([LEFT, resized], choiceOf(RIGHT))).toBe(resized);
  });

  it('matches by exact geometry when the id is gone', () => {
    const renumbered: FakeDisplay = { ...RIGHT, id: 99 };

    expect(resolveWallpaperDisplay([LEFT, renumbered], choiceOf(RIGHT))).toBe(renumbered);
  });

  it('matches by geometry when the platform gave no usable id', () => {
    // Both carry the unusable id -1: only the geometry tells them apart.
    const unidentified: FakeDisplay = { ...RIGHT, id: -1 };
    const alsoUnidentified: FakeDisplay = { ...LEFT, id: -1 };

    expect(resolveWallpaperDisplay([alsoUnidentified, unidentified], choiceOf(unidentified))).toBe(unidentified);
  });

  it('gives nothing when the chosen display is not connected', () => {
    expect(resolveWallpaperDisplay([LEFT], choiceOf(RIGHT))).toBeNull();
  });

  it('gives nothing without a choice', () => {
    expect(resolveWallpaperDisplay([LEFT, RIGHT], null)).toBeNull();
  });

  it('works the same with one display connected', () => {
    expect(resolveWallpaperDisplay([LEFT], choiceOf(LEFT))).toBe(LEFT);
    expect(resolveWallpaperDisplay([LEFT], choiceOf(RIGHT))).toBeNull();
    expect(resolveWallpaperDisplay([LEFT], null)).toBeNull();
  });
});

describe('shouldMoveWallpaper', () => {
  const on = (display: FakeDisplay) => ({ id: display.id, bounds: display.bounds });

  it('never moves a wallpaper without a choice, even when its display is gone', () => {
    expect(shouldMoveWallpaper([LEFT, RIGHT], null, on(RIGHT))).toBe(false);
    expect(shouldMoveWallpaper([LEFT], null, on(RIGHT))).toBe(false);
  });

  it('moves a wallpaper that is not on the connected chosen display', () => {
    expect(shouldMoveWallpaper([LEFT, RIGHT], choiceOf(RIGHT), on(LEFT))).toBe(true);
  });

  it('leaves a wallpaper that is on the chosen display, also after that display changed size', () => {
    const resized: FakeDisplay = { ...RIGHT, bounds: { x: 2560, y: 0, width: 1280, height: 720 } };

    expect(shouldMoveWallpaper([LEFT, RIGHT], choiceOf(RIGHT), on(RIGHT))).toBe(false);
    expect(shouldMoveWallpaper([LEFT, resized], choiceOf(RIGHT), on(RIGHT))).toBe(false);
  });

  it('moves a wallpaper off the chosen display when that display is unplugged', () => {
    expect(shouldMoveWallpaper([LEFT], choiceOf(RIGHT), on(RIGHT))).toBe(true);
  });

  it('leaves a wallpaper on its fallback display while the chosen display stays unplugged', () => {
    expect(shouldMoveWallpaper([LEFT], choiceOf(RIGHT), on(LEFT))).toBe(false);
  });

  it('does nothing when no wallpaper is up or no display is reported', () => {
    expect(shouldMoveWallpaper([LEFT, RIGHT], choiceOf(RIGHT), null)).toBe(false);
    expect(shouldMoveWallpaper([], choiceOf(RIGHT), on(RIGHT))).toBe(false);
  });
});

describe('normalizeWallpaperDisplayChoice', () => {
  it('keeps id, geometry and label of a whole choice and drops everything else', () => {
    expect(normalizeWallpaperDisplayChoice({ ...RIGHT, rotation: 90 })).toEqual(choiceOf(RIGHT));
  });

  it('reads anything that is not a whole choice as no choice', () => {
    expect(normalizeWallpaperDisplayChoice(undefined)).toBeNull();
    expect(normalizeWallpaperDisplayChoice(null)).toBeNull();
    expect(normalizeWallpaperDisplayChoice(22)).toBeNull();
    expect(normalizeWallpaperDisplayChoice({ id: 22 })).toBeNull();
    expect(normalizeWallpaperDisplayChoice({ id: '22', bounds: RIGHT.bounds })).toBeNull();
    expect(normalizeWallpaperDisplayChoice({ id: 22, bounds: { x: 0, y: 0, width: 1920 } })).toBeNull();
  });
});

describe('describeWallpaperDisplays', () => {
  it('lists the connected displays and says which one the choice and the wallpaper are', () => {
    const renumbered: FakeDisplay = { ...RIGHT, id: 99 };
    const state = describeWallpaperDisplays({ displays: [LEFT, renumbered], primaryId: LEFT.id, choice: choiceOf(RIGHT), active: LEFT });

    expect(state.displays).toEqual([
      { id: 11, label: 'Left', bounds: LEFT.bounds, scaleFactor: 1, primary: true },
      { id: 99, label: 'Right', bounds: RIGHT.bounds, scaleFactor: 1.25, primary: false },
    ]);
    expect(state.choice).toEqual(choiceOf(RIGHT));
    expect(state.chosenId).toBe(99);
    expect(state.activeId).toBe(11);
  });

  it('names no chosen display when the choice is not connected', () => {
    const state = describeWallpaperDisplays({ displays: [LEFT], primaryId: LEFT.id, choice: choiceOf(RIGHT), active: LEFT });

    expect(state.chosenId).toBeNull();
    expect(state.choice).toEqual(choiceOf(RIGHT));
  });
});

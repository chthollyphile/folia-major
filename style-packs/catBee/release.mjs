import { createPaint } from '../lyricImprint/paint.mjs';
import { createTrail } from './trail.mjs';

// One lifetime rule, three distinct entrances; only the bee keeps traveling after text is emitted.
export const releaseTime = (phrase, unit, mode = phrase.mode) => mode === 'glyph' ? unit.start : phrase.releaseStart;
export const holdUntil = phrase => phrase.fadeAt;
export const createRelease = ctx => createPaint(ctx, createTrail(ctx));

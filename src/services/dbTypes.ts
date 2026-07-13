import type { LyricData, Theme } from '../types';

// src/services/dbTypes.ts
// Holds facade types separately so repositories do not depend on the db compatibility entry point.

export interface SessionData {
  audioFile?: File | Blob;
  fileName?: string;
  lyricId?: string;
  lyrics?: LyricData;
  theme?: Theme;
  cachedAiBg?: string;
  coverUrl?: string;
  timestamp?: number;
}

export interface CacheData {
  key: string;
  data: unknown;
  timestamp: number;
}


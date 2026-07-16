import { appDatabase } from '../appDatabase';
import type { SessionData } from '../dbTypes';

// src/services/repositories/sessionRepository.ts
// Preserves the native v6 out-of-line session keys through Dexie's explicit-key table API.

const SESSION_KEYS: Array<keyof SessionData> = [
  'audioFile',
  'fileName',
  'lyricId',
  'lyrics',
  'theme',
  'cachedAiBg',
  'coverUrl',
];

export const putSessionValue = async (key: keyof SessionData, value: unknown): Promise<void> => {
  await appDatabase.session.put(value, key);
};

export const readSession = async (): Promise<SessionData> => {
  const values = await appDatabase.session.bulkGet(SESSION_KEYS as string[]);
  return SESSION_KEYS.reduce<SessionData>((session, key, index) => {
    if (values[index] !== undefined) {
      (session as Record<string, unknown>)[key] = values[index];
    }
    return session;
  }, {});
};

export const clearSessionValues = async (): Promise<void> => {
  await appDatabase.session.clear();
};


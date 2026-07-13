import { appDatabase, type ThemeRegistryRecord } from '../appDatabase';

// src/services/repositories/themeRegistryRepository.ts
// Encapsulates the dedicated theme sync registry table.

export const readThemeRegistryEntries = async <T>(): Promise<T[]> => (
  await appDatabase.theme_registry.toArray() as T[]
);

export const writeThemeRegistryEntries = async <T extends ThemeRegistryRecord>(entries: T[]): Promise<void> => {
  if (entries.length > 0) {
    await appDatabase.theme_registry.bulkPut(entries);
  }
};


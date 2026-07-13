// src/types/localLibrary.ts
// Defines stable local-library identities independently from file paths and online source ids.

export type LocalLibraryEntityKind = 'artist' | 'album';

export interface LocalLibraryEntity {
  id: string;
  kind: LocalLibraryEntityKind;
  displayName: string;
  aliases: string[];
  normalizedAliases: string[];
  mergedInto?: string;
  needsReview?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type LocalLibraryAssignmentOrigin = 'import' | 'matched' | 'manual' | 'split';

export interface LocalLibraryAssignment {
  songId: string;
  artistEntityIds: string[];
  artistOrigin: LocalLibraryAssignmentOrigin;
  albumEntityId?: string;
  albumOrigin: LocalLibraryAssignmentOrigin;
  updatedAt: number;
}


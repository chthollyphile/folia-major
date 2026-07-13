import type { LocalLibraryEntity, LocalLibraryEntityKind } from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect } from './localLibraryIndex';
import { cleanLocalLibraryName, normalizeLocalLibraryName } from './localLibraryNames';

// src/utils/localLibraryResolver.ts
// Resolves names to stable entities while surfacing ambiguity instead of merging uncertain identities.

export interface ResolveLocalLibraryEntityOptions {
  entities: LocalLibraryEntity[];
  kind: LocalLibraryEntityKind;
  name: string;
  currentEntityId?: string;
  preferredEntityIds?: string[];
  now?: number;
  createId?: () => string;
}

export interface ResolvedLocalLibraryEntity {
  entity: LocalLibraryEntity;
  created: boolean;
}

const defaultCreateId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-entity-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

// Selects a unique alias match, uses explicit context for ambiguity, or creates a reviewable entity.
export const resolveLocalLibraryEntity = ({
  entities,
  kind,
  name,
  currentEntityId,
  preferredEntityIds = [],
  now = Date.now(),
  createId = defaultCreateId,
}: ResolveLocalLibraryEntityOptions): ResolvedLocalLibraryEntity | null => {
  const displayName = cleanLocalLibraryName(name);
  if (!displayName) return null;
  const normalizedName = normalizeLocalLibraryName(displayName);
  const index = buildLocalLibraryIndex(entities);
  const candidateIds = (index.entityIdsByAlias.get(`${kind}:${normalizedName}`) || [])
    .map(id => followEntityRedirect(id, index.entitiesById))
    .filter((id): id is string => Boolean(id));
  const uniqueCandidateIds = Array.from(new Set(candidateIds));

  const contextualIds = [currentEntityId, ...preferredEntityIds]
    .map(id => id && followEntityRedirect(id, index.entitiesById))
    .filter((id): id is string => Boolean(id));
  const contextualMatch = contextualIds.find(id => uniqueCandidateIds.includes(id));
  const resolvedId = uniqueCandidateIds.length === 1 ? uniqueCandidateIds[0] : contextualMatch;
  const resolved = resolvedId ? index.entitiesById.get(resolvedId) : undefined;
  if (resolved) return { entity: resolved, created: false };

  const entity: LocalLibraryEntity = {
    id: createId(),
    kind,
    displayName,
    aliases: [displayName],
    normalizedAliases: [normalizedName],
    needsReview: uniqueCandidateIds.length > 1 || undefined,
    createdAt: now,
    updatedAt: now,
  };
  return { entity, created: true };
};


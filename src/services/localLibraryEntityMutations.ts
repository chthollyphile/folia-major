import type {
  LocalLibraryArtistAssignmentMode,
  LocalLibraryAssignment,
  LocalLibraryEntity,
  LocalLibrarySplitTarget,
} from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect } from '../utils/localLibraryIndex';
import { cleanLocalLibraryName, normalizeLocalLibraryName } from '../utils/localLibraryNames';
import { appDatabase } from './appDatabase';
import { appendUnique, createLocalLibraryEntityId } from './localLibraryCatalogInternals';

// src/services/localLibraryEntityMutations.ts
// Implements merge, split, and display-name changes without mixing them into metadata application.

export const mergeEntities = async (targetEntityId: string, sourceEntityIds: string[]): Promise<void> => {
  await appDatabase.transaction(
    'rw',
    [appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const entities = await appDatabase.local_library_entities.toArray();
      const index = buildLocalLibraryIndex(entities);
      const targetId = followEntityRedirect(targetEntityId, index.entitiesById);
      const target = targetId && index.entitiesById.get(targetId);
      if (!target) throw new Error(`Local library entity not found: ${targetEntityId}`);
      const sourceIds = sourceEntityIds
        .map(id => followEntityRedirect(id, index.entitiesById))
        .filter((id): id is string => Boolean(id && id !== target.id));
      const sources = sourceIds
        .map(id => index.entitiesById.get(id))
        .filter((entity): entity is LocalLibraryEntity => Boolean(entity));
      if (sources.some(source => source.kind !== target.kind)) throw new Error('Cannot merge different entity kinds');

      target.aliases = appendUnique([...target.aliases, ...sources.flatMap(source => source.aliases)]);
      target.normalizedAliases = appendUnique([...target.normalizedAliases, ...sources.flatMap(source => source.normalizedAliases)]);
      target.updatedAt = Date.now();
      sources.forEach(source => {
        source.mergedInto = target.id;
        source.updatedAt = Date.now();
      });

      const sourceSet = new Set(sourceIds);
      const changedAssignments = (await appDatabase.local_library_assignments.toArray()).flatMap(assignment => {
        const next = { ...assignment };
        if (target.kind === 'artist') {
          const replaced = assignment.artistEntityIds.map(id => sourceSet.has(id) ? target.id : id);
          if (!replaced.some((id, position) => id !== assignment.artistEntityIds[position])) return [];
          next.artistEntityIds = appendUnique(replaced);
        } else {
          if (!assignment.albumEntityId || !sourceSet.has(assignment.albumEntityId)) return [];
          next.albumEntityId = target.id;
        }
        next.updatedAt = Date.now();
        return [next];
      });
      await Promise.all([
        appDatabase.local_library_entities.bulkPut([target, ...sources]),
        appDatabase.local_library_assignments.bulkPut(changedAssignments),
      ]);
    },
  );
};

export const splitEntity = async (
  entityId: string,
  songIds: string[],
  displayName: string,
): Promise<LocalLibraryEntity> => {
  return await appDatabase.transaction(
    'rw',
    [appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const source = await appDatabase.local_library_entities.get(entityId);
      const cleanedName = cleanLocalLibraryName(displayName);
      if (!source || !cleanedName) throw new Error('Cannot split a missing or unnamed entity');
      const now = Date.now();
      const entity: LocalLibraryEntity = {
        id: createLocalLibraryEntityId(),
        kind: source.kind,
        displayName: cleanedName,
        aliases: [cleanedName],
        normalizedAliases: [normalizeLocalLibraryName(cleanedName)],
        createdAt: now,
        updatedAt: now,
      };
      const assignments = (await appDatabase.local_library_assignments.bulkGet(songIds))
        .filter((assignment): assignment is LocalLibraryAssignment => Boolean(assignment))
        .map(assignment => source.kind === 'artist'
          ? {
              ...assignment,
              artistEntityIds: assignment.artistEntityIds.map(id => id === source.id ? entity.id : id),
              artistOrigin: 'split' as const,
              updatedAt: now,
            }
          : assignment.albumEntityId === source.id
            ? { ...assignment, albumEntityId: entity.id, albumOrigin: 'split' as const, updatedAt: now }
            : assignment);
      await Promise.all([
        appDatabase.local_library_entities.put(entity),
        appDatabase.local_library_assignments.bulkPut(assignments),
      ]);
      return entity;
    },
  );
};

// Reassigns only the selected members while leaving both existing entities active.
export const moveEntityMembersToExistingEntity = async (
  sourceEntityId: string,
  targetEntityId: string,
  songIds: string[],
): Promise<LocalLibraryEntity> => {
  return await appDatabase.transaction(
    'rw',
    [appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const entities = await appDatabase.local_library_entities.toArray();
      const index = buildLocalLibraryIndex(entities);
      const sourceId = followEntityRedirect(sourceEntityId, index.entitiesById);
      const targetId = followEntityRedirect(targetEntityId, index.entitiesById);
      const source = sourceId && index.entitiesById.get(sourceId);
      const target = targetId && index.entitiesById.get(targetId);
      if (!source || !target) throw new Error('Cannot move members between missing entities');
      if (source.id === target.id) throw new Error('Cannot move members into the same entity');
      if (source.kind !== target.kind) throw new Error('Cannot move members between different entity kinds');

      const now = Date.now();
      const assignments = (await appDatabase.local_library_assignments.bulkGet(Array.from(new Set(songIds))))
        .filter((assignment): assignment is LocalLibraryAssignment => Boolean(assignment))
        .flatMap((assignment): LocalLibraryAssignment[] => {
          if (source.kind === 'artist') {
            if (!assignment.artistEntityIds.includes(source.id)) return [];
            return [{
              ...assignment,
              artistEntityIds: appendUnique(assignment.artistEntityIds.map(id => id === source.id ? target.id : id)),
              artistOrigin: 'split' as const,
              updatedAt: now,
            }];
          }
          if (assignment.albumEntityId !== source.id) return [];
          return [{
            ...assignment,
            albumEntityId: target.id,
            albumOrigin: 'split' as const,
            updatedAt: now,
          }];
        });
      if (assignments.length === 0) throw new Error('No selected members belong to the source entity');
      await appDatabase.local_library_assignments.bulkPut(assignments);
      return target;
    },
  );
};

// Applies multiple existing or newly named artists using explicit append/replace semantics.
export const splitArtistEntityToTargets = async (
  sourceEntityId: string,
  songIds: string[],
  destinations: LocalLibrarySplitTarget[],
  mode: LocalLibraryArtistAssignmentMode,
): Promise<LocalLibraryEntity[]> => {
  return await appDatabase.transaction(
    'rw',
    [appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const entities = await appDatabase.local_library_entities.toArray();
      const index = buildLocalLibraryIndex(entities);
      const resolvedSourceId = followEntityRedirect(sourceEntityId, index.entitiesById);
      const source = resolvedSourceId && index.entitiesById.get(resolvedSourceId);
      if (!source || source.kind !== 'artist') throw new Error('Cannot split a missing or non-artist entity');

      const now = Date.now();
      const selectedTargets: LocalLibraryEntity[] = [];
      const selectedTargetIds = new Set<string>();
      const selectedNames = new Set<string>();
      const newEntities: LocalLibraryEntity[] = [];

      destinations.forEach(destination => {
        const resolvedTargetId = destination.entityId
          ? followEntityRedirect(destination.entityId, index.entitiesById)
          : undefined;
        const existingTarget = resolvedTargetId && index.entitiesById.get(resolvedTargetId);
        if (destination.entityId) {
          if (!existingTarget || existingTarget.kind !== 'artist' || existingTarget.id === source.id) {
            throw new Error('Cannot split into an invalid artist entity');
          }
          if (!selectedTargetIds.has(existingTarget.id)) {
            selectedTargets.push(existingTarget);
            selectedTargetIds.add(existingTarget.id);
            selectedNames.add(normalizeLocalLibraryName(existingTarget.displayName));
          }
          return;
        }

        const cleanedName = cleanLocalLibraryName(destination.displayName);
        if (!cleanedName) return;
        const normalizedName = normalizeLocalLibraryName(cleanedName);
        if (!normalizedName || selectedNames.has(normalizedName)) return;
        const entity: LocalLibraryEntity = {
          id: createLocalLibraryEntityId(),
          kind: 'artist',
          displayName: cleanedName,
          aliases: [cleanedName],
          normalizedAliases: [normalizedName],
          createdAt: now,
          updatedAt: now,
        };
        selectedTargets.push(entity);
        newEntities.push(entity);
        selectedTargetIds.add(entity.id);
        selectedNames.add(normalizedName);
      });

      if (selectedTargets.length === 0) throw new Error('At least one artist destination is required');
      const targetIds = selectedTargets.map(entity => entity.id);
      const assignments = (await appDatabase.local_library_assignments.bulkGet(Array.from(new Set(songIds))))
        .filter((assignment): assignment is LocalLibraryAssignment => Boolean(assignment))
        .flatMap((assignment): LocalLibraryAssignment[] => {
          if (!assignment.artistEntityIds.includes(source.id)) return [];
          return [{
            ...assignment,
            artistEntityIds: mode === 'append'
              ? appendUnique([...assignment.artistEntityIds, ...targetIds])
              : targetIds,
            artistOrigin: 'split' as const,
            updatedAt: now,
          }];
        });
      if (assignments.length === 0) throw new Error('No selected members belong to the source artist');
      await Promise.all([
        newEntities.length > 0 ? appDatabase.local_library_entities.bulkPut(newEntities) : Promise.resolve(),
        appDatabase.local_library_assignments.bulkPut(assignments),
      ]);
      return selectedTargets;
    },
  );
};

export const setEntityDisplayName = async (entityId: string, displayName: string): Promise<void> => {
  const cleanedName = cleanLocalLibraryName(displayName);
  if (!cleanedName) throw new Error('Entity display name cannot be empty');
  await appDatabase.local_library_entities.where('id').equals(entityId).modify(entity => {
    entity.displayName = cleanedName;
    entity.aliases = appendUnique([...entity.aliases, cleanedName]);
    entity.normalizedAliases = appendUnique([...entity.normalizedAliases, normalizeLocalLibraryName(cleanedName)]);
    entity.updatedAt = Date.now();
  });
};


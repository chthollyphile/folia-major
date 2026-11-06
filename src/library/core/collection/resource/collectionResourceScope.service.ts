import type { CollectionResourceContext } from '../../shared/resource.contract';
import type { LibraryCollectionDescriptor } from '../collection.contract';

// Account-library access follows the active signed-in source, never a stale/history-restored descriptor.
export const canAccessCollectionResource = (
    descriptor: LibraryCollectionDescriptor,
    context: CollectionResourceContext,
): boolean => {
    if (descriptor.source !== 'online' || descriptor.type !== 'library_songs') return true;
    const scope = context.librarySongsScope;
    return scope != null
        && context.currentUserId != null
        && scope.userId != null
        && descriptor.providerId === scope.providerId
        && String(descriptor.id) === String(scope.userId)
        && String(context.currentUserId) === String(scope.userId);
};

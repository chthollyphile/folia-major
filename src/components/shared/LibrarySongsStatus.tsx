import { useTranslation } from 'react-i18next';
import type { CollectionResourceSnapshot } from '../../library/core/shared/resource.contract';
import { projectLibrarySongsPresentation } from '../../library/core/collection/librarySongsPresentation';

// Persistent loaded-scope notice shared by the grid and terminal suites.

export const LibrarySongsStatus = ({ snapshot, onResume, className = '' }: {
    snapshot: CollectionResourceSnapshot | null | undefined;
    onResume: () => void;
    className?: string;
}) => {
    const { t } = useTranslation();
    const presentation = projectLibrarySongsPresentation(snapshot?.librarySongs, snapshot?.status ?? null, snapshot?.sync.status ?? 'none');
    if (!presentation) return null;
    const sync = snapshot?.sync;
    return (
        <div className={className} data-library-songs-status={presentation.key}>
            <p role="status" aria-live="polite">{t(`librarySongs.${presentation.key}`, { count: presentation.count })}</p>
            {presentation.filterPartial && <p className="mt-0.5 opacity-65">{t('librarySongs.filterPartial')}</p>}
            {presentation.retry && (
                <button
                    type="button"
                    className="mt-1 underline decoration-dotted"
                    onClick={onResume}
                    title={sync?.status === 'interrupted' ? t('playlist.syncFailedHint', { error: sync.message }) : undefined}
                >
                    {t('ui.retry')}
                </button>
            )}
        </div>
    );
};

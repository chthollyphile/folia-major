import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { LocalLibraryEntity } from '../../types/localLibrary';
import {
  mergeEntities,
  moveEntityMembersToExistingEntity,
  setEntityDisplayName,
  splitEntity,
} from '../../services/localLibraryCatalogService';
import { EntityEditorWorkspace } from '../local-library-entity/EntityEditorWorkspace';

// src/components/modal/LocalLibraryEntityPanel.tsx
// Orchestrates entity mutations in Folia's context-aware editor.

interface LocalLibraryEntityPanelProps {
  entity: LocalLibraryEntity;
  sameKindEntities: LocalLibraryEntity[];
  memberSongs: LocalSong[];
  isDaylight: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

type EntityEditorFeedback = {
  type: 'success' | 'error';
  text: string;
};

export const LocalLibraryEntityPanel = ({
  entity,
  sameKindEntities,
  memberSongs,
  isDaylight,
  onClose,
  onChanged,
}: LocalLibraryEntityPanelProps) => {
  const { t } = useTranslation();
  const entityKindLabel = entity.kind === 'artist'
    ? t('localMusic.artistLabel')
    : t('localMusic.albumLabel');
  const panelTheme = isDaylight
    ? 'bg-white/80 border-white/40 text-zinc-900 shadow-2xl shadow-black/5 backdrop-saturate-150'
    : 'bg-zinc-950/80 border-white/10 text-white shadow-2xl shadow-black/50 backdrop-saturate-150';
  const borderTheme = isDaylight ? 'border-zinc-200/60' : 'border-white/10';
  const closeButtonTheme = isDaylight ? 'hover:bg-zinc-200/50 text-zinc-500 hover:text-zinc-900' : 'hover:bg-white/10 text-zinc-400 hover:text-white';
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<EntityEditorFeedback | null>(null);

  // Runs one mutation at a time and keeps operation feedback inside the editor.
  const run = async (operation: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
    setPending(true);
    setFeedback(null);
    try {
      await operation();
      await onChanged();
      setFeedback({ type: 'success', text: successMessage });
      return true;
    } catch (error) {
      console.error('[LocalLibraryEntityPanel] Entity mutation failed:', error);
      setFeedback({ type: 'error', text: t('localMusic.entityOperationFailed') });
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      data-folia-keyboard-window="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 backdrop-blur-xl md:p-6"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-library-entity-title"
        className={`${panelTheme} flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-md`}
      >
        <header className={`flex shrink-0 items-center justify-between gap-5 border-b px-8 py-6 ${borderTheme}`}>
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] opacity-50">
              <span>{entity.kind === 'artist' ? t('localMusic.artistLabel') : t('localMusic.albumLabel')}</span>
              <span>·</span>
              <span>{t('localMusic.entityMemberCount', { count: memberSongs.length })}</span>
            </div>
            <h2 id="local-library-entity-title" className="truncate text-xl font-bold tracking-tight">{entity.displayName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`shrink-0 rounded-full p-2.5 transition-colors ${closeButtonTheme}`}
            aria-label={t('localMusic.cancel')}
          >
            <X size={22} />
          </button>
        </header>

        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden px-8"
            >
              <div
                className={`mt-6 flex shrink-0 items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm backdrop-blur-md ${
                  feedback.type === 'success'
                    ? (isDaylight ? 'border-emerald-500/30 bg-emerald-50 text-emerald-700' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400')
                    : (isDaylight ? 'border-rose-500/30 bg-rose-50 text-rose-700' : 'border-rose-500/30 bg-rose-500/10 text-rose-400')
                }`}
                role="status"
              >
                {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {feedback.text}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <EntityEditorWorkspace
            entity={entity}
            sameKindEntities={sameKindEntities}
            memberSongs={memberSongs}
            isDaylight={isDaylight}
            pending={pending}
            onRename={displayName => run(
              () => setEntityDisplayName(entity.id, displayName),
              t('localMusic.entitySaved'),
            )}
            onMerge={(candidateId, mergeIntoCurrent) => run(
              async () => {
                if (mergeIntoCurrent) {
                  await mergeEntities(entity.id, [candidateId]);
                } else {
                  await mergeEntities(candidateId, [entity.id]);
                  setTimeout(onClose, 1500); // Close after showing feedback briefly
                }
              },
              t('localMusic.entityMerged', { kind: entityKindLabel }),
            )}
            onSplit={(songIds, displayName, targetEntityId) => run(
              () => targetEntityId
                ? moveEntityMembersToExistingEntity(entity.id, targetEntityId, songIds)
                : splitEntity(entity.id, songIds, displayName),
              targetEntityId
                ? t('localMusic.entityMembersMoved', { kind: entityKindLabel })
                : t('localMusic.entitySplitDone', { kind: entityKindLabel }),
            )}
          />
        </main>
      </motion.div>
    </div>
  );
};

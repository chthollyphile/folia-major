import { useMemo, useState } from 'react';
import { Check, GitMerge, Scissors, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { LocalLibraryEntity } from '../../types/localLibrary';
import {
  mergeEntities,
  setEntityDisplayName,
  splitEntity,
} from '../../services/localLibraryCatalogService';

// src/components/modal/LocalLibraryEntityPanel.tsx
// Edits entity display names and performs explicit merge/split membership operations.

interface LocalLibraryEntityPanelProps {
  entity: LocalLibraryEntity;
  sameKindEntities: LocalLibraryEntity[];
  memberSongs: LocalSong[];
  isDaylight: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

export const LocalLibraryEntityPanel = ({
  entity,
  sameKindEntities,
  memberSongs,
  isDaylight,
  onClose,
  onChanged,
}: LocalLibraryEntityPanelProps) => {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(entity.displayName);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [splitName, setSplitName] = useState('');
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  const candidates = useMemo(() => {
    const counts = new Map<string, number>();
    memberSongs.forEach(song => {
      const values = entity.kind === 'artist'
        ? [song.embeddedArtist, ...(song.manualArtistNames || []), ...(song.matchedArtistEntities?.map(item => item.name) || []), song.matchedArtists]
        : [song.embeddedAlbum, song.manualAlbumName, song.matchedAlbumName];
      values.filter((value): value is string => Boolean(value?.trim())).forEach(value => {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [entity.kind, memberSongs]);

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    try {
      await operation();
      await onChanged();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
      <div className={`max-h-[82vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
        isDaylight ? 'border-black/10 bg-white text-zinc-900' : 'border-white/10 bg-zinc-900 text-white'
      }`}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('localMusic.entityInfo')}</h2>
            <p className="text-xs opacity-60">{entity.id}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-current/10" aria-label={t('localMusic.cancel')}>
            <X size={18} />
          </button>
        </div>

        <section className="mb-6 space-y-3">
          <label className="text-xs font-semibold opacity-70">{t('localMusic.entityDisplayName')}</label>
          <div className="flex gap-2">
            <input value={displayName} onChange={event => setDisplayName(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-current/15 bg-transparent px-3 py-2" />
            <button
              disabled={pending || !displayName.trim()}
              onClick={() => void run(async () => setEntityDisplayName(entity.id, displayName))}
              className="flex items-center gap-1 rounded-xl bg-current px-4 py-2 text-sm text-white mix-blend-difference disabled:opacity-40"
            >
              <Check size={14} /> {t('localMusic.save')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {candidates.map(([name, count]) => (
              <button key={name} onClick={() => setDisplayName(name)} className="rounded-full border border-current/15 px-3 py-1 text-xs">
                {name} · {count}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 space-y-3">
          <label className="text-xs font-semibold opacity-70">{t('localMusic.mergeEntity')}</label>
          <div className="flex gap-2">
            <select value={mergeSourceId} onChange={event => setMergeSourceId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-current/15 bg-inherit px-3 py-2">
              <option value="">{t('localMusic.selectEntity')}</option>
              {sameKindEntities.filter(item => item.id !== entity.id && !item.mergedInto).map(item => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
            <button
              disabled={pending || !mergeSourceId}
              onClick={() => void run(async () => mergeEntities(entity.id, [mergeSourceId]))}
              className="flex items-center gap-1 rounded-xl border border-current/15 px-4 py-2 text-sm disabled:opacity-40"
            >
              <GitMerge size={14} /> {t('localMusic.mergeEntity')}
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <label className="text-xs font-semibold opacity-70">{t('localMusic.splitEntity')}</label>
          <input value={splitName} onChange={event => setSplitName(event.target.value)} placeholder={t('localMusic.newEntityName')} className="w-full rounded-xl border border-current/15 bg-transparent px-3 py-2" />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-current/10 p-2">
            {memberSongs.map(song => (
              <label key={song.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-current/5">
                <input
                  type="checkbox"
                  checked={selectedSongIds.has(song.id)}
                  onChange={() => setSelectedSongIds(current => {
                    const next = new Set(current);
                    if (next.has(song.id)) next.delete(song.id);
                    else next.add(song.id);
                    return next;
                  })}
                />
                <span className="truncate text-sm">{song.title || song.fileName}</span>
              </label>
            ))}
          </div>
          <button
            disabled={pending || !splitName.trim() || selectedSongIds.size === 0}
            onClick={() => void run(async () => {
              await splitEntity(entity.id, Array.from(selectedSongIds), splitName);
              setSelectedSongIds(new Set());
              setSplitName('');
            })}
            className="flex items-center gap-1 rounded-xl border border-current/15 px-4 py-2 text-sm disabled:opacity-40"
          >
            <Scissors size={14} /> {t('localMusic.splitEntity')}
          </button>
        </section>
      </div>
    </div>
  );
};


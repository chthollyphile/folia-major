import { useMemo, useState } from 'react';
import { Check, HardDrive, Search, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List as VirtualList, type RowComponentProps } from 'react-window';
import type { LocalSong } from '../../types';
import { filterEntityMemberSongs } from './entityEditorModel';

// src/components/local-library-entity/FolderSongPicker.tsx
// Provides a reusable virtualized folder-song selector with an optional per-song match action.

interface FolderSongPickerProps {
    songs: LocalSong[];
    selectedSongIds: Set<string>;
    onToggle: (songId: string) => void;
    onManualMatch?: (song: LocalSong) => void;
    manualMatchLabel?: string;
    statusBySongId?: Map<string, string>;
    disabled?: boolean;
    isDaylight: boolean;
}

type SongRowProps = Omit<FolderSongPickerProps, 'songs'> & { songs: LocalSong[] };

const SongRow = ({ index, style, ariaAttributes, songs, selectedSongIds, onToggle, onManualMatch, manualMatchLabel, statusBySongId, disabled, isDaylight }: RowComponentProps<SongRowProps>) => {
    const { t } = useTranslation();
    const song = songs[index];
    const selected = selectedSongIds.has(song.id);
    const automaticMatchDisabled = Boolean(song.noAutoMatch);
    return (
        <div {...ariaAttributes} style={style} className="px-1 py-1">
            <div className={`flex h-full items-center gap-3 rounded-xl border px-3 transition-colors ${selected
                ? isDaylight ? 'border-blue-300 bg-blue-50' : 'border-blue-500/40 bg-blue-500/15'
                : isDaylight ? 'border-black/5 bg-white' : 'border-white/10 bg-white/5'}`}>
                <button
                    type="button"
                    disabled={disabled || automaticMatchDisabled}
                    onClick={() => onToggle(song.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                >
                    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border ${selected ? 'border-blue-500 bg-blue-500 text-white' : automaticMatchDisabled ? 'border-amber-500/35 bg-amber-500/10' : 'border-current/20'}`}>
                        {selected && <Check size={12} strokeWidth={3} />}
                        {!selected && automaticMatchDisabled && <HardDrive size={11} className="text-amber-500" />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{song.title || song.fileName}</span>
                        <span className={`block truncate text-[11px] ${automaticMatchDisabled ? 'font-semibold text-amber-500/90' : 'opacity-50'}`}>
                            {(automaticMatchDisabled ? t('localMusic.localInfoAutoMatchSkipped') : statusBySongId?.get(song.id))
                                || song.onlineMetadata?.artists.map(artist => artist.name).join(', ')
                                || song.importedMetadata.artistNames.join(', ')
                                || song.importedMetadata.albumName
                                || song.fileName}
                        </span>
                    </span>
                </button>
                {onManualMatch && (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onManualMatch(song)}
                        className="shrink-0 rounded-lg p-2 opacity-55 transition hover:bg-blue-500/10 hover:opacity-100 disabled:opacity-25"
                        aria-label={manualMatchLabel}
                    >
                        <WandSparkles size={15} />
                    </button>
                )}
            </div>
        </div>
    );
};

export const FolderSongPicker = (props: FolderSongPickerProps) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const songs = useMemo(() => filterEntityMemberSongs(props.songs, query), [props.songs, query]);
    const rowProps = useMemo(() => ({ ...props, songs }), [props, songs]);
    return (
        <div className="min-w-0">
            <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${props.isDaylight ? 'border-black/10 bg-white/70' : 'border-white/10 bg-black/20'}`}>
                <Search size={15} className="opacity-50" />
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t('localMusic.searchEntitySongs')}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
            </label>
            <div className="mt-2 h-72 overflow-hidden">
                {songs.length > 0 ? (
                    <VirtualList
                        style={{ height: '100%', width: '100%' }}
                        rowCount={songs.length}
                        rowHeight={66}
                        rowProps={rowProps}
                        rowComponent={SongRow}
                        className="custom-scrollbar"
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-sm opacity-45">{t('localMusic.noEntitySongs')}</div>
                )}
            </div>
        </div>
    );
};

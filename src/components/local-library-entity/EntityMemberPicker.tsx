import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List as VirtualList, type RowComponentProps } from 'react-window';
import type { LocalSong } from '../../types';
import { filterEntityMemberSongs } from './entityEditorModel';

// src/components/local-library-entity/EntityMemberPicker.tsx
// Provides the searchable member selection shown only while splitting an entity.

type EntityMemberPickerProps = {
    memberSongs: LocalSong[];
    selectedSongIds: Set<string>;
    onToggle: (songId: string) => void;
    isDaylight: boolean;
};

type SongRowProps = Pick<EntityMemberPickerProps, 'selectedSongIds' | 'onToggle' | 'isDaylight'> & {
    songs: LocalSong[];
};

const SongRow = ({ index, style, ariaAttributes, songs, selectedSongIds, onToggle, isDaylight }: RowComponentProps<SongRowProps>) => {
    const song = songs[index];
    const selected = selectedSongIds.has(song.id);

    return (
        <div {...ariaAttributes} style={style} className="px-1 py-0.5">
            <button
                type="button"
                onClick={() => onToggle(song.id)}
                className={`flex h-full w-full items-center gap-4 rounded-xl border px-4 text-left transition-all duration-200 ${selected
                    ? isDaylight ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-blue-500/15 border-blue-500/40 shadow-sm'
                    : isDaylight ? 'bg-white border-black/5 hover:border-black/15 hover:shadow-md' : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'
                }`}
            >
                <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors ${selected
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : isDaylight ? 'border-black/20' : 'border-white/20'
                    }`}
                >
                    {selected && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-semibold ${selected ? (isDaylight ? 'text-blue-900' : 'text-blue-100') : ''}`}>{song.title || song.fileName}</span>
                    <span className={`block truncate text-[11px] opacity-50 ${selected ? (isDaylight ? 'text-blue-800' : 'text-blue-200') : ''}`}>
                        {song.importedMetadata.artistNames.join(', ') || song.importedMetadata.albumName || song.fileName}
                    </span>
                </span>
            </button>
        </div>
    );
};

export const EntityMemberPicker = ({ memberSongs, selectedSongIds, onToggle, isDaylight }: EntityMemberPickerProps) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const songs = useMemo(() => filterEntityMemberSongs(memberSongs, query), [memberSongs, query]);
    const rowProps = useMemo(() => ({
        songs,
        selectedSongIds,
        onToggle,
        isDaylight,
    }), [isDaylight, onToggle, selectedSongIds, songs]);
    const inputTheme = isDaylight
        ? 'bg-white/60 focus-within:bg-white border-black/10 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/20 focus-within:shadow-sm'
        : 'bg-black/20 focus-within:bg-black/40 border-white/10 focus-within:border-blue-500/50 focus-within:ring-4 focus-within:ring-blue-500/20 focus-within:shadow-sm';

    return (
        <div className="min-w-0">
            <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-200 ${inputTheme}`}>
                <Search size={16} className="text-blue-500 opacity-80" />
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t('localMusic.searchEntitySongs')}
                    aria-label={t('localMusic.searchEntitySongs')}
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                />
            </div>

            <div className="mt-2 h-64 overflow-hidden">
                {songs.length > 0 ? (
                    <VirtualList
                        style={{ height: '100%', width: '100%' }}
                        rowCount={songs.length}
                        rowHeight={56}
                        rowProps={rowProps}
                        rowComponent={SongRow}
                        className="custom-scrollbar"
                    />
                ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-xs opacity-40">
                        {t('localMusic.noEntitySongs')}
                    </div>
                )}
            </div>
        </div>
    );
};

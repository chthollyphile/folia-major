import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileAudio, Loader2, Music, Search, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { calculateMatchScoreDetails } from '../../../utils/lyrics/matchScore';
import {
    getLyricMatchSourceLabel,
    getMatchResultAlbumName,
    getMatchResultArtists,
    getMatchResultCoverUrl,
} from '../../../utils/lyrics/matchResult';
import { formatSongName } from '../../../utils/songNameFormatter';
import { DurationMatchBadge } from '../DurationMatchBadge';
import { LyricPreviewPanel } from './LyricPreviewPanel';
import type { LyricMatchSearch } from './useLyricMatchSearch';

// src/components/modal/lyric-match/LyricMatchWindow.tsx
// The window for matching lyrics to a song by hand: source tabs, a search box, the results, and
// on the right the chosen result with a preview of its lyric. It is the same for every kind of
// song; what differs comes in as props from the kind's own file (LocalSongLyricMatch,
// OnlineSongLyricMatch, NavidromeSongLyricMatch).

export interface LyricMatchWindowProps {
    /** The search this window shows and drives: useLyricMatchSearch, called by the kind. */
    search: LyricMatchSearch;
    isDaylight: boolean;
    onClose: () => void;
    /** Text after the window's title. */
    titleNote?: string;
    /** The song being matched, under the title. */
    songLine?: string;
    /** Its file name, for a song that is a file. */
    fileName?: string;
    /** True: a result as long as the song says so beside its score. */
    showsDurationMatch?: boolean;
    /** What the right side shows: the chosen result, or the song while none is chosen. */
    preview: { coverUrl?: string | null; title: React.ReactNode; artist: string; album: string };
    /** Controls only this kind has, between the cover and the names. */
    controls?: React.ReactNode;
    /** One labelled fact under the names. */
    status?: { label: string; text: string; tone: 'blue' | 'green' | 'orange' | 'muted' } | null;
    /** The save button's text while it saves. */
    savingLabel: string;
    /** Stores the chosen result. The save button is busy until it settles. */
    onSave: (result: SongResult) => Promise<void>;
    /** "No match" for this kind of song: the button's text and what it does. Without it there is no such button. */
    noMatch?: { label: string; run: () => Promise<void> };
    /** Buttons only this kind has, beside "no match" at the start of the footer. */
    footerActions?: React.ReactNode;
    /** True: the window lies over every other layer of the app (the player bar too). */
    overAllLayers?: boolean;
    /** True: the app's keyboard shortcuts stay on while the window is open. */
    keepsHotkeys?: boolean;
    /** True: a click on the dimmed page around the window closes it; a press that began inside the window does not. */
    closesOnBackdropClick?: boolean;
    /** Anything else the kind shows over the window, such as a question it asks. */
    children?: React.ReactNode;
}

export const LyricMatchWindow: React.FC<LyricMatchWindowProps> = ({
    search,
    isDaylight,
    onClose,
    titleNote,
    songLine,
    fileName,
    showsDurationMatch,
    preview,
    controls,
    status,
    savingLabel,
    onSave,
    noMatch,
    footerActions,
    overAllLayers,
    keepsHotkeys,
    closesOnBackdropClick,
    children,
}) => {
    const { t } = useTranslation();
    const [isSaving, setIsSaving] = useState(false);
    const isMouseDownOnOverlayRef = useRef(false);
    const { songInfo, source, sources, query, results, isSearching, selectedResult } = search;

    // Dynamic theme classes
    const bgClass = isDaylight ? 'bg-white/90 border-white/20' : 'bg-zinc-900/95 border-white/10';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10 border-black/10 focus:border-black/20' : 'bg-white/5 focus:bg-white/10 border-white/10 focus:border-white/20';
    const searchBtnBg = isDaylight ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300';
    const resultItemBg = isDaylight ? 'bg-black/5 hover:bg-black/10 border-black/5' : 'bg-white/5 hover:bg-white/10 border-white/5';
    const resultItemSelected = isDaylight ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-500/20 border-blue-500/50';
    const closeBtnHover = isDaylight ? 'hover:bg-zinc-200/50' : 'hover:bg-white/10';
    const cancelBtnBg = isDaylight ? 'bg-zinc-100/80 hover:bg-zinc-200' : 'bg-white/5 hover:bg-white/10';
    const noMatchBtnBg = isDaylight ? 'bg-red-500/5 hover:bg-red-500/10 border-red-500/10' : 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20';
    const statusTone = {
        blue: isDaylight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/20 text-blue-300',
        orange: isDaylight ? 'bg-orange-500/10 text-orange-600' : 'bg-orange-500/20 text-orange-300',
        green: 'bg-green-500/20 text-green-300',
        muted: 'bg-white/10 opacity-60',
    };

    const whileSaving = async (action: () => Promise<void>) => {
        setIsSaving(true);
        try {
            await action();
        } finally {
            setIsSaving(false);
        }
    };

    const resultKeyOf = (result: SongResult) => `${source}-${result.amllDbPlatform ?? 'base'}-${result.id}`;
    const selectedKey = selectedResult ? resultKeyOf(selectedResult) : null;

    return (
        <div
            data-folia-keyboard-window={keepsHotkeys ? undefined : 'true'}
            className={`fixed inset-0 ${overAllLayers ? 'z-[200]' : 'z-50'} bg-black/60 backdrop-blur-xl flex items-center justify-center p-6`}
            onMouseDown={closesOnBackdropClick ? event => { isMouseDownOnOverlayRef.current = event.target === event.currentTarget; } : undefined}
            onClick={closesOnBackdropClick ? event => { if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) onClose(); } : undefined}
        >
            <div
                data-ponder="lyric-match"
                className={`${bgClass} border rounded-2xl max-w-5xl w-full max-h-[80vh] flex flex-col shadow-2xl backdrop-blur-md`}
                onClick={closesOnBackdropClick ? event => event.stopPropagation() : undefined}
            >
                {/* Header */}
                <div className={`px-6 py-4 border-b ${borderColor} flex items-center justify-between`}>
                    <div className="min-w-0">
                        <h2 className={`text-lg font-bold ${textPrimary}`}>{t('localMusic.matchLyrics')}{titleNote ? ` ${titleNote}` : ''}</h2>
                        {songLine !== undefined && <p className={`mt-1 truncate text-xs ${textSecondary}`}>{songLine}</p>}
                        {fileName !== undefined && (
                            <div title={fileName} className={`mt-1 flex min-w-0 items-center gap-1 text-[11px] opacity-55 ${textSecondary}`}>
                                <FileAudio size={12} className="shrink-0" />
                                <span className="shrink-0">{t('localMusic.filename')}:</span>
                                <span className="truncate">{fileName}</span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 ${closeBtnHover} rounded-lg transition-colors ${textPrimary}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body: Two-panel layout */}
                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* LEFT PANEL: Search + Results (wider) */}
                    <div className={`w-[62%] flex flex-col border-r ${borderColor}`}>
                        {/* Search Bar */}
                        <div className="p-4">
                            <div className={`flex border-b ${borderColor} pb-2 mb-3.5 gap-4`}>
                                {sources.map(id => {
                                    const activeTabClass = source === id
                                        ? isDaylight
                                            ? 'border-blue-500 text-blue-600 font-semibold'
                                            : 'border-blue-400 text-blue-300 font-semibold'
                                        : 'border-transparent text-zinc-400 hover:text-zinc-200';
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => search.setSource(id)}
                                            className={`pb-2 border-b-2 text-sm transition-all px-1 cursor-pointer ${activeTabClass}`}
                                        >
                                            {getLyricMatchSourceLabel(id)}
                                        </button>
                                    );
                                })}
                            </div>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void search.submit();
                                }}
                                className="flex gap-3"
                            >
                                <div className={`flex-1 flex items-center gap-3 rounded-2xl border px-4 py-3 ${inputBg}`}>
                                    <Search size={18} className={`opacity-40 ${textSecondary}`} />
                                    <input
                                        type="text"
                                        value={query}
                                        onChange={(e) => search.setQuery(e.target.value)}
                                        placeholder={t('localMusic.searchForSong')}
                                        className={`flex-1 bg-transparent outline-none text-sm ${textPrimary}`}
                                        autoFocus
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={isSearching}
                                    className={`px-4 rounded-2xl text-sm font-medium transition-colors ${searchBtnBg}`}
                                >
                                    {isSearching ? <Loader2 size={16} className="animate-spin" /> : t('localMusic.search')}
                                </button>
                            </form>
                        </div>

                        {/* Results List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
                            {isSearching ? (
                                <div className="flex justify-center items-center h-40">
                                    <Loader2 className="animate-spin opacity-50" size={28} />
                                </div>
                            ) : results.length === 0 ? (
                                <div className={`flex flex-col items-center justify-center h-40 opacity-50 ${textSecondary}`}>
                                    <Music size={40} className="mb-2" />
                                    <p className="text-sm">{t('localMusic.noResults')}</p>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {results.map((result) => {
                                        const resultKey = resultKeyOf(result);
                                        const resultCoverUrl = getMatchResultCoverUrl(result, source);
                                        const resultArtists = getMatchResultArtists(result);
                                        const resultAlbum = getMatchResultAlbumName(result);
                                        const matchDetails = calculateMatchScoreDetails(songInfo, result);
                                        return (
                                            <div
                                                key={resultKey}
                                                onClick={() => search.setSelectedResult(result)}
                                                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${selectedKey === resultKey
                                                    ? resultItemSelected
                                                    : resultItemBg
                                                    }`}
                                            >
                                                <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                                                    {resultCoverUrl ? (
                                                        <img
                                                            src={getSizedCoverUrl(resultCoverUrl, 512)}
                                                            alt={result.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <Music size={16} className="opacity-20" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-sm font-semibold truncate ${textPrimary}`}>{formatSongName(result)}</span>
                                                        <span className="text-[10px] px-1.5 bg-blue-500/10 text-blue-400 rounded-md font-mono shrink-0">
                                                            {matchDetails.score}%
                                                        </span>
                                                        {showsDurationMatch && <DurationMatchBadge matched={matchDetails.durationMatched} />}
                                                    </div>
                                                    <div className={`text-xs truncate ${textSecondary}`}>
                                                        {[resultArtists, resultAlbum].filter(Boolean).join(' · ')}
                                                    </div>
                                                </div>
                                                {selectedKey === resultKey && (
                                                    <Check size={16} className="text-blue-400 flex-shrink-0" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: Centered-style preview with lower-half LyricPreviewPanel */}
                    <div className={`w-[38%] flex flex-col items-center justify-between px-6 py-6 border-l ${borderColor} min-h-0 overflow-hidden`}>
                        {/* Upper section: Cover, the kind's controls and Info centered (Scrollable when height is constrained) */}
                        <div className="flex flex-col items-center justify-start w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                            {/* Cover Image */}
                            <div className="w-32 h-32 min-h-[64px] rounded-2xl overflow-hidden bg-zinc-800 shadow-md flex-shrink transition-all duration-300">
                                {preview.coverUrl ? (
                                    <img
                                        src={getSizedCoverUrl(preview.coverUrl, 512)}
                                        alt="Cover"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Music size={28} className="opacity-10" />
                                    </div>
                                )}
                            </div>

                            {controls}

                            {/* Song Info (Centered) */}
                            <div className="w-full space-y-1.5 mt-4 text-center flex-shrink-0">
                                <h3 className={`text-base font-bold line-clamp-2 leading-snug px-2 ${textPrimary}`}>
                                    {preview.title}
                                </h3>
                                <div className={`text-sm opacity-75 font-medium line-clamp-1 ${textPrimary}`}>
                                    {preview.artist}
                                </div>
                                <div className={`text-xs opacity-60 line-clamp-1 ${textPrimary}`}>
                                    {preview.album}
                                </div>

                                {status && (
                                    <div className="flex items-center justify-center gap-2 pt-0.5">
                                        <span className={`text-[11px] ${textSecondary}`}>{status.label}</span>
                                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusTone[status.tone]}`}>
                                            {status.text}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Lyric Preview Panel */}
                        <div className="w-full h-28 flex-shrink-0 mt-4 flex flex-col">
                            <LyricPreviewPanel
                                selectedResult={selectedResult}
                                source={source}
                                isDaylight={isDaylight}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className={`px-6 py-4 border-t ${borderColor} flex flex-wrap justify-end gap-3`}>
                    {(noMatch || footerActions) && (
                        <div className="mr-auto flex flex-wrap gap-3">
                            {noMatch && (
                                <button
                                    onClick={() => void whileSaving(noMatch.run)}
                                    className={`px-5 py-2 ${noMatchBtnBg} text-red-400 border rounded-lg transition-colors text-sm whitespace-nowrap`}
                                >
                                    {noMatch.label}
                                </button>
                            )}
                            {footerActions}
                        </div>
                    )}
                    <button
                        onClick={onClose}
                        className={`px-5 py-2 ${cancelBtnBg} rounded-lg transition-colors ${textPrimary} text-sm whitespace-nowrap`}
                    >
                        {t('localMusic.cancel')}
                    </button>
                    <button
                        onClick={() => { if (selectedResult) void whileSaving(() => onSave(selectedResult)); }}
                        disabled={!selectedResult || isSaving}
                        className="px-5 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm text-white whitespace-nowrap"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="animate-spin" size={14} />
                                <span>{savingLabel}</span>
                            </>
                        ) : (
                            t('localMusic.save')
                        )}
                    </button>
                </div>
            </div>
            {children}
        </div>
    );
};

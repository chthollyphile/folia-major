import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef } from 'react-window';
import type { Theme } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { Button, FIELD_CLASS } from '../../modal/settings/kit';
import FontFallbackStackControl from './FontFallbackStackControl';

// src/components/visualizer/window/FontPicker.tsx
// The layer the lyric style window draws over itself to choose a custom font, for the lyrics or
// for the subtitles: the fonts installed on this machine, searched and each written in itself,
// with the font chosen now and its fallback list above them. A browser that cannot read the
// installed fonts gets a file upload instead (mobile), or is told so. The window's shell gives the
// layer the keyboard and closes it on Escape; it is drawn with the settings kit's parts and colours.

export interface LocalFontEntry {
    family: string;
    label: string;
}

interface LocalFontDataLike {
    family: string;
}

type QueryLocalFontsWindow = Window & {
    queryLocalFonts?: () => Promise<LocalFontDataLike[]>;
};

type FontPickerProps = {
    /** The font chosen for what the picker is opened for, if one is. */
    family: string | null;
    /** That font's name as the user sees it. */
    label: string;
    fallbackFamilies: string[];
    onFallbackFamiliesChange?: (families: string[]) => void;
    /** The built-in face a font falls back to in its own row. */
    fontStyle: Theme['fontStyle'];
    onChoose: (font: LocalFontEntry) => void;
    /** Back to the built-in font. */
    onClear: () => void;
    onUpload?: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    onClose: () => void;
};

const FONT_ROW_HEIGHT = 64;
const FONT_FILE_TYPES = '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf,application/font-woff,application/font-woff2,application/x-font-ttf,application/x-font-otf,application/vnd.ms-opentype';

/** The fonts read from this machine: read once for the life of the page. */
let knownFonts: LocalFontEntry[] | null = null;

const isMobileBrowser = () => {
    if (typeof navigator === 'undefined') {
        return false;
    }

    const userAgent = navigator.userAgent;
    const platform = navigator.platform;
    const maxTouchPoints = navigator.maxTouchPoints ?? 0;
    const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean; }; }).userAgentData;
    if (typeof userAgentData?.mobile === 'boolean') {
        return userAgentData.mobile;
    }

    if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) {
        return true;
    }

    if (/Macintosh/i.test(userAgent) && /Mac/i.test(platform) && maxTouchPoints > 1) {
        return true;
    }

    const hasCoarsePointer = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
    const compactTouchScreen = typeof screen !== 'undefined'
        && Math.min(screen.width, screen.height) <= 820
        && maxTouchPoints > 0;

    return hasCoarsePointer && compactTouchScreen;
};

const dedupeLocalFonts = (fonts: LocalFontDataLike[]) => {
    const entries = new Map<string, LocalFontEntry>();

    fonts.forEach(font => {
        const family = font.family?.trim();
        if (!family) {
            return;
        }

        const key = family.toLocaleLowerCase();
        if (!entries.has(key)) {
            entries.set(key, {
                family,
                label: family,
            });
        }
    });

    return Array.from(entries.values()).sort((left, right) => left.label.localeCompare(right.label));
};

const Notice: React.FC<{ error?: boolean; children: React.ReactNode }> = ({ error, children }) => (
    <p className={`rounded-lg bg-[var(--st-fill)] px-3 py-2.5 text-[13px] leading-5 ${error ? 'text-[color:var(--st-err)]' : 'text-[color:var(--st-t2)]'}`}>{children}</p>
);

/** What every row of the list is given beside its place. */
type FontRowData = {
    fonts: LocalFontEntry[];
    family: string | null;
    fontStyle: Theme['fontStyle'];
    onChoose: (font: LocalFontEntry) => void;
};

/**
 * One font of the list, written in itself. Defined once: the list takes a new row component for
 * new rows and throws the old ones away, and a row that held the focus would lose it to the body.
 */
const FontRow = ({ index, style, ariaAttributes, fonts, family, fontStyle, onChoose }: {
    index: number;
    style: React.CSSProperties;
    ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem'; };
} & FontRowData) => {
    const font = fonts[index];
    const chosen = family?.toLocaleLowerCase() === font.family.toLocaleLowerCase();

    return (
        <div style={style} {...ariaAttributes}>
            <button
                type="button"
                aria-pressed={chosen}
                onClick={() => onChoose(font)}
                className={`st-focus-inside st-t-fast flex w-full flex-col justify-center rounded-lg px-3 text-left transition-colors ${chosen ? 'bg-[var(--st-fill2)] shadow-[inset_0_0_0_1.5px_var(--st-accent)]' : 'hover:bg-[var(--st-fill)]'}`}
                style={{ height: FONT_ROW_HEIGHT - 4 }}
            >
                <span className="block truncate text-[17px] leading-6" style={{ fontFamily: resolveThemeFontStack({ fontStyle, fontFamily: font.family }) }}>
                    {font.label}
                </span>
                <span className="block truncate text-xs leading-[18px] text-[color:var(--st-t3)]">{font.family}</span>
            </button>
        </div>
    );
};

export const FontPicker: React.FC<FontPickerProps> = ({
    family, label, fallbackFamilies, onFallbackFamiliesChange, fontStyle, onChoose, onClear, onUpload, onClose,
}) => {
    const { t } = useTranslation();
    const [fonts, setFonts] = useState<LocalFontEntry[]>(knownFonts ?? []);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [listHeight, setListHeight] = useState(0);
    const listBoxRef = useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const canReadFonts = typeof window !== 'undefined' && Boolean((window as QueryLocalFontsWindow).queryLocalFonts);
    const uploadsInstead = !canReadFonts && isMobileBrowser() && Boolean(onUpload);

    // The installed fonts are read when the picker first opens.
    useEffect(() => {
        if (knownFonts || uploadsInstead) {
            return undefined;
        }
        const read = (window as QueryLocalFontsWindow).queryLocalFonts;
        if (!read) {
            setError(t('options.systemFontUnsupported'));
            return undefined;
        }
        let stopped = false;
        setIsLoading(true);
        read.call(window).then((found) => {
            const next = dedupeLocalFonts(found);
            if (next.length > 0) {
                knownFonts = next;
            }
            if (!stopped) {
                setFonts(next);
                setError(next.length === 0 ? t('options.systemFontEmpty') : null);
            }
        }).catch((reason) => {
            console.error('[VisPlayground] Failed to query local fonts:', reason);
            if (!stopped) {
                setError(reason instanceof Error && reason.message ? reason.message : t('options.systemFontPermissionDenied'));
            }
        }).finally(() => {
            if (!stopped) {
                setIsLoading(false);
            }
        });
        return () => {
            stopped = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const shownFonts = useMemo(() => {
        const wanted = query.trim().toLocaleLowerCase();
        return wanted ? fonts.filter(font => font.label.toLocaleLowerCase().includes(wanted)) : fonts;
    }, [fonts, query]);
    const showsList = !uploadsInstead && !isLoading && !error && shownFonts.length > 0;

    useEffect(() => {
        const box = listBoxRef.current;
        if (!box) {
            return undefined;
        }
        const measure = () => setListHeight(box.clientHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        return () => observer.disconnect();
    }, [showsList]);

    // A new search starts at the top of what it found.
    useEffect(() => {
        listRef.current?.scrollToRow({ index: 0, align: 'start', behavior: 'instant' });
    }, [query, shownFonts.length, listRef]);

    const handleUploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !onUpload) {
            return;
        }
        setError(null);
        setIsUploading(true);
        try {
            const result = await onUpload(file);
            if (result.ok) {
                onClose();
            } else {
                setError(result.error || t('options.uploadFontFailed'));
            }
        } finally {
            setIsUploading(false);
        }
    };

    // The rows get one function for the life of the picker; it asks the handler of the last drawing.
    const onChooseRef = useRef(onChoose);
    onChooseRef.current = onChoose;
    const chooseFont = useCallback((font: LocalFontEntry) => onChooseRef.current(font), []);

    const title = t(uploadsInstead ? 'options.uploadCustomFont' : 'options.chooseSystemFont');

    return (
        // Over everything in the window, the sample's own button too.
        <div className="absolute inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--st-win)_72%,transparent)] p-4 backdrop-blur-sm sm:p-6">
            <div
                role="dialog"
                aria-label={title}
                className="flex h-full max-h-[640px] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-[var(--st-win)] shadow-[0_24px_60px_rgba(0,0,0,0.35),0_0_0_1px_var(--st-line2)]"
            >
                <div className="flex items-start gap-3 px-5 pb-3 pt-4">
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold leading-6">{title}</h3>
                        <p className="text-xs leading-[18px] text-[color:var(--st-t3)]">
                            {t(uploadsInstead ? 'options.uploadCustomFontDesc' : 'options.chooseSystemFontDesc')}
                        </p>
                    </div>
                    <Button variant="quiet" icon={X} tip={t('ui.close')} onClick={onClose} />
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
                    {!uploadsInstead && (
                        <label className={`${FIELD_CLASS} flex w-full shrink-0 items-center gap-2 px-2.5`}>
                            <Search size={14} className="shrink-0 text-[color:var(--st-t3)]" />
                            <input
                                type="text"
                                // The keyboard starts in the search.
                                autoFocus
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={t('options.searchSystemFont')}
                                aria-label={t('options.searchSystemFont')}
                                spellCheck={false}
                                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--st-t3)]"
                            />
                        </label>
                    )}

                    <div className="shrink-0 rounded-lg bg-[var(--st-fill)] px-3 py-2">
                        <div className="text-xs leading-[18px] text-[color:var(--st-t3)]">{t('options.currentFont')}</div>
                        <div className="truncate text-sm leading-5">{family ? label : t('options.systemFontInactive')}</div>
                        <div className="truncate text-xs leading-[18px] text-[color:var(--st-t3)]">
                            {fallbackFamilies.length > 0 ? fallbackFamilies.join(', ') : t('options.fontFallbackEmpty')}
                        </div>
                    </div>
                    <FontFallbackStackControl
                        label={t('options.fontFallbackFamilies')}
                        value={fallbackFamilies}
                        onChange={onFallbackFamiliesChange}
                        placeholder={t('options.fontFallbackFamiliesPlaceholder') || 'Songti SC, SimSun, serif'}
                    />

                    {uploadsInstead ? (
                        <>
                            <input ref={uploadInputRef} type="file" accept={FONT_FILE_TYPES} className="hidden" onChange={handleUploadFile} />
                            {error && <Notice error>{error}</Notice>}
                            <div className="flex flex-wrap gap-2">
                                <Button variant="primary" icon={isUploading ? undefined : Upload} disabled={isUploading} onClick={() => uploadInputRef.current?.click()}>
                                    {isUploading && <Loader2 size={14} className="animate-spin" />}
                                    {t(isUploading ? 'options.uploadingCustomFont' : 'options.uploadCustomFont')}
                                </Button>
                                {family && (
                                    <Button
                                        onClick={() => {
                                            onClear();
                                            onClose();
                                        }}
                                    >
                                        {t('options.clearSystemFont')}
                                    </Button>
                                )}
                            </div>
                        </>
                    ) : isLoading ? (
                        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-[color:var(--st-t2)]">
                            <Loader2 size={16} className="animate-spin" />
                            <span>{t('options.loadingSystemFonts')}</span>
                        </div>
                    ) : error ? (
                        <Notice>{error}</Notice>
                    ) : shownFonts.length === 0 ? (
                        <Notice>{t('options.systemFontNoResults')}</Notice>
                    ) : (
                        <div ref={listBoxRef} className="min-h-0 flex-1">
                            {listHeight > 0 && (
                                <List
                                    listRef={listRef}
                                    rowCount={shownFonts.length}
                                    rowHeight={FONT_ROW_HEIGHT}
                                    rowComponent={FontRow}
                                    rowProps={{ fonts: shownFonts, family, fontStyle, onChoose: chooseFont }}
                                    overscanCount={6}
                                    className="st-scroll"
                                    style={{ height: listHeight, width: '100%' }}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FontPicker;

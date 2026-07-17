import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, GitMerge, Pencil, Plus, Scissors, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type {
    LocalLibraryArtistAssignmentMode,
    LocalLibraryEntity,
    LocalLibrarySplitTarget,
} from '../../types/localLibrary';
import { normalizeLocalLibraryName } from '../../utils/localLibraryNames';
import { ArtistSplitModeSelector } from './ArtistSplitModeSelector';
import { ArtistSplitTargetList } from './ArtistSplitTargetList';
import { EntityMemberPicker } from './EntityMemberPicker';
import { EntityTargetPicker } from './EntityTargetPicker';
import {
    buildEntityNameSuggestions,
    filterMergeEntitySuggestions,
    findExactEntitySuggestion,
} from './entityEditorModel';

// src/components/local-library-entity/EntityEditorWorkspace.tsx
// Adapts one name input and one primary action to rename, merge, or split context.

type EntityEditorWorkspaceProps = {
    entity: LocalLibraryEntity;
    sameKindEntities: LocalLibraryEntity[];
    memberSongs: LocalSong[];
    isDaylight: boolean;
    pending: boolean;
    onRename: (displayName: string) => Promise<boolean>;
    onMerge: (sourceEntityId: string, mergeIntoCurrent: boolean) => Promise<boolean>;
    onSplit: (
        songIds: string[],
        targets: LocalLibrarySplitTarget[],
        artistMode: LocalLibraryArtistAssignmentMode,
    ) => Promise<boolean>;
};

export const EntityEditorWorkspace = ({
    entity,
    sameKindEntities,
    memberSongs,
    isDaylight,
    pending,
    onRename,
    onMerge,
    onSplit,
}: EntityEditorWorkspaceProps) => {
    const { t } = useTranslation();
    const entityKindLabel = entity.kind === 'artist'
        ? t('localMusic.artistLabel')
        : t('localMusic.albumLabel');
    const borderTheme = isDaylight ? 'border-zinc-200/60' : 'border-white/10';
    const inputTheme = isDaylight
        ? 'bg-white/60 focus-within:bg-white border-black/10 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/20 focus-within:shadow-sm'
        : 'bg-black/20 focus-within:bg-black/40 border-white/10 focus-within:border-blue-500/50 focus-within:ring-4 focus-within:ring-blue-500/20 focus-within:shadow-sm';
    const resultTheme = isDaylight
        ? 'bg-white border-black/5 hover:border-black/15 shadow-sm hover:shadow-md'
        : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10 shadow-sm';
    const selectedTheme = isDaylight
        ? 'bg-blue-50 border-blue-200 text-blue-900 shadow-sm'
        : 'bg-blue-500/15 border-blue-500/40 text-blue-100 shadow-sm';
    const secondaryButtonTheme = isDaylight
        ? 'bg-zinc-100 hover:bg-zinc-200/80 text-zinc-700'
        : 'bg-white/10 hover:bg-white/15 text-white';
    const [identityInput, setIdentityInput] = useState(entity.displayName);
    const [splitInput, setSplitInput] = useState('');
    const [splitMode, setSplitMode] = useState(false);
    const [mergeSourceId, setMergeSourceId] = useState('');
    const [splitTargetId, setSplitTargetId] = useState('');
    const [artistSplitTargets, setArtistSplitTargets] = useState<LocalLibrarySplitTarget[]>([]);
    const [artistAssignmentMode, setArtistAssignmentMode] = useState<LocalLibraryArtistAssignmentMode>('replace');
    const [mergeIntoCurrent, setMergeIntoCurrent] = useState(false);
    const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        setIdentityInput(entity.displayName);
        setSplitInput('');
        setSplitMode(false);
        setMergeSourceId('');
        setSplitTargetId('');
        setArtistSplitTargets([]);
        setArtistAssignmentMode('replace');
        setMergeIntoCurrent(false);
        setSelectedSongIds(new Set());
    }, [entity.displayName, entity.id]);

    const selectedSongs = useMemo(
        () => memberSongs.filter(song => selectedSongIds.has(song.id)),
        [memberSongs, selectedSongIds],
    );
    const nameSuggestions = useMemo(
        () => buildEntityNameSuggestions(entity.kind, splitMode && selectedSongs.length > 0 ? selectedSongs : memberSongs).slice(0, 5),
        [entity.kind, memberSongs, selectedSongs, splitMode],
    );
    const mergeSuggestions = useMemo(
        () => identityInput.trim()
            ? filterMergeEntitySuggestions(sameKindEntities, entity.id, identityInput, 4)
            : [],
        [entity.id, identityInput, sameKindEntities],
    );
    const splitTargetSuggestions = useMemo(
        () => splitInput.trim()
            ? filterMergeEntitySuggestions(sameKindEntities, entity.id, splitInput, 4)
            : [],
        [entity.id, sameKindEntities, splitInput],
    );
    const exactMergeSource = findExactEntitySuggestion(mergeSuggestions, identityInput);
    const mergeSource = sameKindEntities.find(candidate => candidate.id === mergeSourceId) || exactMergeSource;
    const exactSplitTarget = findExactEntitySuggestion(splitTargetSuggestions, splitInput);
    const splitTarget = sameKindEntities.find(candidate => candidate.id === splitTargetId) || exactSplitTarget;
    const inputValue = splitMode ? splitInput : identityInput;
    const normalizedInput = normalizeLocalLibraryName(inputValue);
    const canRename = Boolean(normalizedInput && normalizedInput !== normalizeLocalLibraryName(entity.displayName));
    const canSubmit = splitMode
        ? selectedSongIds.size > 0 && (entity.kind === 'artist'
            ? artistSplitTargets.length > 0
            : Boolean(splitTarget || normalizedInput))
        : mergeSource
            ? true
            : canRename;

    const toggleSong = useCallback((songId: string) => {
        setSelectedSongIds(current => {
            const next = new Set(current);
            if (next.has(songId)) next.delete(songId);
            else next.add(songId);
            return next;
        });
    }, []);

    const addArtistSplitTarget = (targetEntity: LocalLibraryEntity | undefined = splitTarget) => {
        const displayName = targetEntity?.displayName || splitInput.trim();
        const normalizedName = normalizeLocalLibraryName(displayName);
        if (!normalizedName) return;
        setArtistSplitTargets(current => {
            if (current.some(target => (
                (targetEntity && target.entityId === targetEntity.id)
                || normalizeLocalLibraryName(target.displayName) === normalizedName
            ))) return current;
            return [...current, { entityId: targetEntity?.id, displayName }];
        });
        setSplitInput('');
        setSplitTargetId('');
    };

    // Dispatches the primary button according to the context currently visible to the user.
    const submit = async () => {
        if (!canSubmit || pending) return;
        if (splitMode) {
            const targets = entity.kind === 'artist'
                ? artistSplitTargets
                : [{ entityId: splitTarget?.id, displayName: splitTarget?.displayName || splitInput.trim() }];
            const ok = await onSplit(Array.from(selectedSongIds), targets, artistAssignmentMode);
            if (ok) {
                setSplitMode(false);
                setSplitInput('');
                setSplitTargetId('');
                setArtistSplitTargets([]);
                setSelectedSongIds(new Set());
            }
            return;
        }
        if (mergeSource) {
            const ok = await onMerge(mergeSource.id, mergeIntoCurrent);
            if (ok) setMergeSourceId('');
            return;
        }
        await onRename(identityInput.trim());
    };

    const chooseSuggestedName = (name: string) => {
        if (splitMode) {
            setSplitInput(name);
            setSplitTargetId('');
        }
        else {
            setIdentityInput(name);
            setMergeSourceId('');
        }
    };

    return (
        <motion.div className={`grid gap-6 p-8 ${splitMode ? 'lg:h-[calc(80dvh-7rem)] lg:max-h-[42rem] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:overflow-hidden' : ''}`}>
            <motion.section className={`min-w-0 ${splitMode ? 'lg:min-h-0 lg:overflow-y-auto lg:pr-2 custom-scrollbar' : ''}`}>
                <div className="mb-4">
                    <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-blue-500">
                        {t(splitMode ? 'localMusic.splitEntityEditorTitle' : 'localMusic.editEntityTitle', { kind: entityKindLabel })}
                    </label>
                    <p className="text-[13px] opacity-60 leading-relaxed">
                        {splitMode
                            ? t('localMusic.entitySplitHint', { kind: entityKindLabel })
                            : t('localMusic.entityMergeHint', { kind: entityKindLabel })
                        }
                    </p>
                </div>
                <div className={`flex items-center gap-3 rounded-2xl border px-5 py-4 transition-all duration-200 ${inputTheme}`}>
                    {splitMode ? <Scissors size={20} className="text-blue-500 opacity-80" /> : <Pencil size={20} className="text-blue-500 opacity-80" />}
                    <input
                        value={inputValue}
                        onChange={event => {
                            if (splitMode) {
                                setSplitInput(event.target.value);
                                setSplitTargetId('');
                            }
                            else {
                                setIdentityInput(event.target.value);
                                setMergeSourceId('');
                            }
                        }}
                        onKeyDown={event => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            if (splitMode && entity.kind === 'artist') addArtistSplitTarget();
                            else void submit();
                        }}
                        placeholder={splitMode ? t('localMusic.newOrExistingEntity', { kind: entityKindLabel }) : t('localMusic.searchEntity', { kind: entityKindLabel })}
                        aria-label={splitMode ? t('localMusic.newOrExistingEntity', { kind: entityKindLabel }) : t('localMusic.entityDisplayName')}
                        autoFocus
                        className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
                    />
                    {splitMode && entity.kind === 'artist' && (
                        <button
                            type="button"
                            onClick={() => addArtistSplitTarget()}
                            disabled={!normalizedInput}
                            className="shrink-0 rounded-full bg-blue-500 p-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={t('localMusic.addArtistSplitTarget')}
                            title={t('localMusic.addArtistSplitTarget')}
                        >
                            <Plus size={16} />
                        </button>
                    )}
                </div>

                {nameSuggestions.length > 0 && (
                    <motion.div className="mt-4 flex flex-wrap items-center gap-2">
                        <Sparkles size={14} className="mr-1 text-blue-500 opacity-60" />
                        {nameSuggestions.map(suggestion => (
                            <motion.button
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.97 }}
                                key={suggestion.name}
                                type="button"
                                onClick={() => chooseSuggestedName(suggestion.name)}
                                className={`max-w-full truncate rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${resultTheme}`}
                            >
                                {suggestion.name} <span className="ml-1 opacity-40 text-[10px]">· {suggestion.count}</span>
                            </motion.button>
                        ))}
                    </motion.div>
                )}

                <EntityTargetPicker
                    currentEntity={entity}
                    targetEntity={splitMode && entity.kind === 'artist' ? undefined : splitMode ? splitTarget : mergeSource}
                    suggestions={splitMode ? splitTargetSuggestions : mergeSuggestions}
                    mode={splitMode ? 'move' : 'merge'}
                    mergeIntoCurrent={mergeIntoCurrent}
                    selectedSongCount={selectedSongIds.size}
                    resultTheme={resultTheme}
                    selectedTheme={selectedTheme}
                    onToggleMergeDirection={() => setMergeIntoCurrent(value => !value)}
                    onSelect={candidate => {
                        if (splitMode) {
                            if (entity.kind === 'artist') addArtistSplitTarget(candidate);
                            else {
                                setSplitTargetId(candidate.id);
                                setSplitInput(candidate.displayName);
                            }
                        } else {
                            setMergeSourceId(candidate.id);
                            setIdentityInput(candidate.displayName);
                        }
                    }}
                />

                {splitMode && entity.kind === 'artist' && (
                    <>
                        <ArtistSplitModeSelector
                            mode={artistAssignmentMode}
                            resultTheme={resultTheme}
                            selectedTheme={selectedTheme}
                            onChange={setArtistAssignmentMode}
                        />
                        <ArtistSplitTargetList
                            targets={artistSplitTargets}
                            selectedTheme={selectedTheme}
                            onRemove={index => setArtistSplitTargets(current => current.filter((_, position) => position !== index))}
                        />
                    </>
                )}

            </motion.section>

            {splitMode && (
                <motion.section initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className={`min-w-0 border-t pt-6 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0 ${borderTheme}`}>
                    <div className="mb-4 text-[11px] font-bold uppercase tracking-wider opacity-60">
                        {t('localMusic.selectedSongCount', { count: selectedSongIds.size })}
                    </div>
                    <EntityMemberPicker
                        memberSongs={memberSongs}
                        selectedSongIds={selectedSongIds}
                        onToggle={toggleSong}
                        isDaylight={isDaylight}
                    />
                </motion.section>
            )}

            <motion.footer className={`-mx-8 -mb-8 mt-2 flex flex-wrap items-center justify-end gap-3 border-t px-8 py-5 ${borderTheme} ${splitMode ? 'lg:col-span-2' : ''}`}>
                <button
                    type="button"
                    onClick={() => {
                        setSplitMode(current => !current);
                        setMergeSourceId('');
                        setSplitTargetId('');
                        setArtistSplitTargets([]);
                    }}
                    className={`mr-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors ${secondaryButtonTheme}`}
                >
                    {splitMode ? <ArrowLeft size={16} /> : <Scissors size={16} />}
                    {splitMode ? t('localMusic.backToEntityEditing') : t('localMusic.chooseSongsToSplit')}
                </button>
                <button
                    type="button"
                    disabled={!canSubmit || pending}
                    onClick={() => void submit()}
                    className="flex max-w-full items-center justify-center gap-2 rounded-xl bg-blue-500 hover:bg-blue-600 active:bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
                >
                    <span className="shrink-0 flex items-center">
                        {splitMode ? (splitTarget || artistSplitTargets.length > 0 ? <GitMerge size={16} /> : <Scissors size={16} />) : mergeSource ? <GitMerge size={16} /> : <Check size={16} />}
                    </span>
                    <span className="min-w-0 truncate">
                        {splitMode
                            ? (entity.kind === 'artist'
                                ? t('localMusic.splitSelectedToArtistsAction', { songCount: selectedSongIds.size, artistCount: artistSplitTargets.length })
                                : splitTarget
                                ? t('localMusic.moveSelectedToExistingAction', { count: selectedSongIds.size, kind: entityKindLabel, name: splitTarget.displayName })
                                : t('localMusic.splitSelectedAction', { count: selectedSongIds.size, kind: entityKindLabel }))
                            : mergeSource
                                ? t('localMusic.confirmMergeInto', { name: mergeIntoCurrent ? entity.displayName : mergeSource.displayName })
                                : t('localMusic.confirmRename')}
                    </span>
                </button>
            </motion.footer>
        </motion.div>
    );
};

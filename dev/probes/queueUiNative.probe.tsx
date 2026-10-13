import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ProbeDefinition } from './definition';
import type { SongResult } from '../../src/types';
import QueueTab from '../../src/components/panelTab/QueueTab';
import CommandPaletteQueueView from '../../src/components/command-palette/CommandPaletteQueueView';
import type { CommandPaletteMatch } from '../../src/components/command-palette/types';
import { buildQueueSearchIndex, evaluateQueueSearch } from '../../src/components/command-palette/queueSearch';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { queueUiRegistry, type QueueUiExtension } from '../../src/mods/folium/queueUi';
import type { QueueUiMountContext } from '../../src/mods/folium/queueUi';
import { applyLocalLibraryEntityDisplay } from '../../src/services/playbackAdapters';
import activateQueueUiSample from '../folium/sample-queue-ui/client.mjs';
import { buttonMount, componentWidth, textMount } from '../folium/sample-queue-ui/components.mjs';
import { createFoliumIcon } from '../../src/mods/folium/icons';

// dev/probes/queueUiNative.probe.tsx
// Native queue surfaces plus append-only contributions. All songs and actions are local fixtures.

const SOURCE: SongResult[] = Array.from({ length: 30 }, (_, index) => ({
    id: index < 2 ? 'duplicate' : `queue-ui-${index}`,
    name: `Queue Track ${index}`,
    artists: [{ id: index, name: `Artist ${index}` }],
    album: { id: index, name: 'Fixture Album' },
    durationMs: 180_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: index < 2 ? 'duplicate' : `queue-ui-${index}` },
} as SongResult));
const listeners = new Set<() => void>();
const EMPTY_QUEUE: SongResult[] = [];
let contentMode = true;
let actionOnlyMode = false;
let customMode = false;
let mountedFields = 0;
let providerReads = 0;
let calls: string[] = [];
let likes = 15;
const record = (value: string) => {
    calls.push(value);
    document.querySelector('[data-probe-call-log]')?.setAttribute('data-probe-call-log', JSON.stringify(calls));
};
const notify = () => listeners.forEach(listener => listener());
const resetReads = () => {
    providerReads = 0;
    document.querySelector('[data-probe-read-count]')?.setAttribute('data-probe-read-count', '0');
};

function QueueUiNativeProbe() {
    const [enabled, setEnabled] = useState(false);
    const [sample, setSample] = useState(false);
    const [empty, setEmpty] = useState(false);
    const [large, setLarge] = useState(false);
    const [daylight, setDaylight] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [keepOpen, setKeepOpen] = useState(false);
    const queueScrollRef = useRef<HTMLDivElement | null>(null);
    const largeQueue = useMemo(() => Array.from({ length: 10_000 }, (_, index) => ({
        ...SOURCE[2], id: `large-${index}`, name: `Large Track ${index}`,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: `large-${index}` },
    } as SongResult)), []);
    const queue = empty ? EMPTY_QUEUE : large ? largeQueue : SOURCE;
    // App.tsx maps the store queue into a separate display array before passing it to the player panel.
    const displayQueue = useMemo(() => queue.map(song => applyLocalLibraryEntityDisplay(song)), [queue]);
    const currentSong = queue[0] ?? null;
    const evaluation = useMemo(() => (
        evaluateQueueSearch(buildQueueSearchIndex(queue), currentSong, query)
    ), [currentSong, query, queue]);
    const matches: CommandPaletteMatch[] = useMemo(() => evaluation.matches.map(({ entry, score, reasons }) => ({
        score,
        input: query,
        queueReasons: reasons,
        command: {
            id: `queue-${entry.queueIndex}`,
            group: 'playback',
            title: entry.song.name,
            description: '',
            keywords: [],
            queueSong: entry.song,
            queueIndex: entry.queueIndex,
            execute: () => true,
        },
    })), [evaluation, query]);

    useEffect(() => {
        calls = [];
        likes = 15;
        contentMode = true;
        actionOnlyMode = false;
        customMode = false;
        resetReads();
        return () => queueUiRegistry.unregisterAll('probe-queue-ui');
    }, []);
    useEffect(() => {
        usePlaybackStore.setState({ playQueue: queue, currentSong });
    }, [currentSong, queue]);
    useEffect(() => {
        if (!enabled) return undefined;
        if (sample) return activateQueueUiSample({
            env: { context: 'main' },
            experimental: { 'queue.ui': { register: (def: QueueUiExtension) => queueUiRegistry.register('probe-queue-ui', def) } },
            log: { info: record }, ui: { toast: () => {}, icon: createFoliumIcon },
        });
        const syncMount = buttonMount({ label: 'Fixture sync', icon: () => createFoliumIcon('refresh-cw'), run: () => record('extension:sync') });
        const voteMount = buttonMount({ label: (ctx: QueueUiMountContext) => `Fixture react ${ctx.entry!.index}`,
            icon: () => createFoliumIcon('thumbs-up'), count: () => likes,
            run: (ctx: QueueUiMountContext) => { record(`extension:${ctx.surface}:${ctx.entry!.index}`); likes += 1; notify(); } });
        const overlineMount = textMount((ctx: QueueUiMountContext) => `Recommended by fixture user ${ctx.entry!.index} · ${'long text '.repeat(12)}`);
        const fieldMount = (container: HTMLElement, ctx: QueueUiMountContext) => {
            mountedFields += 1;
            const track = () => document.querySelector('[data-mounted-fields]')?.setAttribute('data-mounted-fields', String(mountedFields));
            track();
            const style = document.createElement('style');
            style.textContent = 'button{background:red!important} input{box-sizing:border-box;width:100%;height:12px;font:10px/12px system-ui;border:0;background:var(--folium-bg);color:var(--folium-primary)}';
            const input = document.createElement('input'); input.setAttribute('aria-label', `Mod note ${ctx.entry!.index}`);
            input.addEventListener('input', () => void ctx.run(() => record(`mod-input:${ctx.surface}:${ctx.entry!.index}:${input.value}`)));
            container.append(style, input);
            return () => { mountedFields -= 1; track(); };
        };
        const handle = queueUiRegistry.register('probe-queue-ui', {
            id: 'append',
            getEntryLayout: () => contentMode && !actionOnlyMode ? 'overline' : 'plain',
            getHeaderContent: surface => contentMode ? [{ id: 'sync', width: componentWidth(surface, true), mount: syncMount }] : [],
            getEntryContent: ({ index, surface }) => {
                providerReads += 1;
                document.querySelector('[data-probe-read-count]')?.setAttribute('data-probe-read-count', String(providerReads));
                return contentMode ? {
                    ...(!actionOnlyMode && index % 2 === 0 ? { overline: { id: 'recommender', mount: customMode ? fieldMount : overlineMount } } : {}),
                    trailing: [{ id: 'react', width: componentWidth(surface), mount: voteMount }],
                } : {};
            },
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        });
        return () => handle.unregister();
    }, [enabled, sample]);

    return (
        <div className="min-h-screen p-6" style={{
            background: daylight ? '#f3ece7' : '#1b171f',
            color: daylight ? '#1e1921' : '#f4edf7',
            ['--bg-color' as string]: daylight ? '#f3ece7' : '#1b171f',
            ['--text-primary' as string]: daylight ? '#1e1921' : '#f4edf7',
            ['--text-accent' as string]: '#b67de3',
        }}>
            <div className="mb-5 flex gap-4">
                <button data-probe-enable onClick={() => setEnabled(value => !value)}>Toggle contribution</button>
                <button data-probe-sample onClick={() => { setSample(true); setEnabled(true); }}>Actual example mod</button>
                <button data-probe-custom onClick={() => { customMode = !customMode; notify(); }}>Custom input</button>
                <button data-probe-outputs onClick={() => { contentMode = !contentMode; notify(); }}>Toggle outputs</button>
                <button data-probe-empty onClick={() => setEmpty(value => !value)}>Toggle empty queue</button>
                <button data-probe-daylight onClick={() => setDaylight(value => !value)}>Toggle daylight</button>
                <button data-probe-filter onClick={() => setQuery(value => value ? '' : 'Track 1')}>Toggle filter</button>
                <button data-probe-large onClick={() => setLarge(value => !value)}>10k queue</button>
                <button data-probe-action-only onClick={() => { actionOnlyMode = !actionOnlyMode; notify(); }}>Actions only</button>
                <button data-probe-notify onClick={() => { resetReads(); likes += 1; notify(); }}>Notify provider</button>
            </div>
            <div className="flex items-start gap-8">
                <section data-probe-panel className="h-[330px] w-[340px] shrink-0">
                    <QueueTab playQueue={displayQueue} currentSong={currentSong} queueScrollRef={queueScrollRef}
                        onPlaySong={song => record(`native:panel:play:${song.name}`)}
                        onShuffle={() => record('native:shuffle')}
                        onOpenLattice={() => record('native:wall')}
                        onMoveSongToNext={index => record(`native:panel:next:${index}`)}
                        onMoveSongToEnd={index => record(`native:panel:end:${index}`)}
                        onRemoveSong={index => record(`native:panel:remove:${index}`)}
                        isDaylight={daylight} />
                </section>
                <section data-probe-command className="h-[520px] w-[670px]">
                    <CommandPaletteQueueView evaluation={evaluation} accentColor="#b67de3"
                        keepOpenOnSongChange={keepOpen} onKeepOpenOnSongChange={setKeepOpen}
                        onAcceptSuggestion={suggestion => setQuery(suggestion.replacement)}
                        onClearAction={() => setQuery('')} onClearFacet={() => setQuery('')}
                        onExecuteBatch={async () => { record('native:batch'); return true; }}
                        activeIndex={activeIndex} onActiveIndexChange={setActiveIndex}
                        currentSong={currentSong} isDaylight={daylight} isExecuting={false}
                        matches={matches} query={query}
                        onExecuteMatch={async index => { record(`native:command:play:${matches[index].command.queueIndex}`); return true; }}
                        onMoveSongToNext={index => record(`native:command:next:${index}`)}
                        onMoveSongToEnd={index => record(`native:command:end:${index}`)}
                        onRemoveSong={index => record(`native:command:remove:${index}`)} />
                </section>
            </div>
            <output data-probe-call-log="[]" className="hidden" />
            <output data-mounted-fields="0" className="hidden" />
            <output data-probe-read-count="0" className="hidden" />
        </div>
    );
}

const definition: ProbeDefinition = {
    id: 'queueUiNative',
    title: 'Queue UI · native and append-only contributions',
    description: 'Compare untouched native markup with appended queue actions, overlines and teardown.',
    Component: QueueUiNativeProbe,
};
export default definition;

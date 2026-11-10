import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
    clearCoverSizeSamples,
    getCoverSizeSamples,
    installCoverSizeAudit,
    resolveCoverSizeSamples,
    subscribeToCoverSizeSamples,
    MAX_TRACKED_URLS,
    type CoverSizeSample,
} from '../../services/debug/coverSizeSamples';
import { copyText } from '../../utils/system/clipboard';

// src/components/shared/CoverSizeAuditPanel.tsx
// Requested cover size against delivered cover size, on whatever the session actually loaded.
//
// The point of the table is the verdict column. Everything downstream of `getSizedCoverUrl` assumes
// a provider honours the size written into the URL; if one ignores it, the pictures still look
// correct and the only trace is the bandwidth and decode cost the sizing was supposed to remove.
// Netease is the one to watch, since `?param=NyN` is a query parameter a CDN is free to drop.

const REFRESH_MS = 1500;

type ProviderGroup = {
    key: string;
    provider: string;
    requested: number | null;
    count: number;
    measured: number;
    /** Split of what came back. A range alone cannot tell a stray small asset from a useless step. */
    exact: number;
    capped: number;
    ignored: number;
    smallestEdge: number;
    largestEdge: number;
    medianDurationMs: number;
    decodedBytes: number;
    /** The URLs that came back bigger than asked. A count alone cannot be chased down. */
    ignoredSamples: CoverSizeSample[];
};

/** Enough to see whether the offenders share a shape, without turning the panel into a log. */
const MAX_IGNORED_SHOWN = 6;

const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const groupSamples = (samples: readonly CoverSizeSample[]): ProviderGroup[] => {
    const groups = new Map<string, { rows: CoverSizeSample[]; provider: string; requested: number | null }>();
    for (const sample of samples) {
        const key = `${sample.provider}:${sample.requested ?? 'none'}`;
        const group = groups.get(key)
            ?? { rows: [], provider: sample.provider, requested: sample.requested };
        group.rows.push(sample);
        groups.set(key, group);
    }

    return [...groups.entries()]
        .map(([key, group]) => {
            const resolved = group.rows.filter(row => row.delivered !== null);
            const edges = resolved.map(row => Math.max(row.delivered!.width, row.delivered!.height))
                .sort((left, right) => left - right);
            const asked = group.requested;
            return {
                key,
                provider: group.provider,
                requested: asked,
                count: group.rows.length,
                measured: resolved.length,
                exact: asked === null ? 0 : edges.filter(edge => edge === asked).length,
                capped: asked === null ? edges.length : edges.filter(edge => edge < asked).length,
                ignored: asked === null ? 0 : edges.filter(edge => edge > asked).length,
                smallestEdge: edges[0] ?? 0,
                largestEdge: edges[edges.length - 1] ?? 0,
                medianDurationMs: median(group.rows.map(row => row.durationMs)),
                decodedBytes: resolved.reduce((sum, row) => sum + row.delivered!.width * row.delivered!.height * 4, 0),
                ignoredSamples: asked === null
                    ? []
                    : resolved.filter(row => Math.max(row.delivered!.width, row.delivered!.height) > asked),
            };
        })
        .sort((left, right) => left.provider.localeCompare(right.provider) || (left.requested ?? 0) - (right.requested ?? 0));
};

/**
 * What came back, counted rather than ranged.
 *
 * A range on its own is close to useless here: "capped 360-512" reads the same whether nearly every
 * asset arrived at the full 512 and a couple of old ones were small, or almost none of them reached
 * it - and those two say opposite things about whether the step is buying anything. So the counts
 * lead. `ignored` is the finding worth acting on: a size was asked for and something bigger came
 * back, which means the ladder is paying for nothing on that host.
 */
const verdictOf = (group: ProviderGroup): { label: string; tone: 'ok' | 'warn' | 'info' } => {
    if (group.measured === 0) return { label: '…', tone: 'info' };
    if (group.requested === null) {
        return { label: `original ${group.smallestEdge}-${group.largestEdge}`, tone: 'info' };
    }

    const parts: string[] = [];
    if (group.exact > 0) parts.push(`${group.exact} exact`);
    if (group.capped > 0) parts.push(`${group.capped} capped, down to ${group.smallestEdge}`);
    if (group.ignored > 0) parts.push(`${group.ignored} ignored, up to ${group.largestEdge}`);
    return { label: parts.join(' · '), tone: group.ignored > 0 ? 'warn' : 'ok' };
};

const formatMb = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;

const CoverSizeAuditPanel: React.FC<{ isDaylight: boolean; panelClass: string }> = ({ isDaylight, panelClass }) => {
    const samples = useSyncExternalStore(subscribeToCoverSizeSamples, getCoverSizeSamples);
    const [onlyNetease, setOnlyNetease] = useState(false);

    // Dimensions are read only while this panel is mounted, so a session nobody is auditing never
    // pays for the probes at all. Installing here too is a safety net rather than the normal path:
    // the app arms the collector at startup so the whole session is covered, but a host that only
    // renders this panel - the probe gallery, a settings page - would otherwise show nothing.
    useEffect(() => {
        installCoverSizeAudit();
        void resolveCoverSizeSamples();
        const timer = window.setInterval(() => { void resolveCoverSizeSamples(); }, REFRESH_MS);
        return () => window.clearInterval(timer);
    }, []);

    const groups = useMemo(
        () => groupSamples(onlyNetease ? samples.filter(sample => sample.provider === 'netease') : samples),
        [onlyNetease, samples],
    );
    // Flattened across rows: an offender is worth seeing whatever bucket it landed in.
    const ignored = useMemo(() => groups.flatMap(group => group.ignoredSamples), [groups]);
    const totals = useMemo(() => ({
        urls: groups.reduce((sum, group) => sum + group.count, 0),
        measured: groups.reduce((sum, group) => sum + group.measured, 0),
        decodedBytes: groups.reduce((sum, group) => sum + group.decodedBytes, 0),
    }), [groups]);

    const cellClass = isDaylight ? 'border-black/10 bg-white/40' : 'border-white/10 bg-white/[0.03]';
    const toneClass = { ok: 'opacity-80', warn: 'text-amber-400', info: 'opacity-55' };

    return (
        <section className={panelClass}>
            <div className="flex items-center justify-between gap-2 px-3 pt-3">
                <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">Cover Sizes</div>
                <div className="flex items-center gap-2 text-[10px]">
                    <label className="flex items-center gap-1 opacity-70">
                        <input type="checkbox" checked={onlyNetease} onChange={event => setOnlyNetease(event.target.checked)} />
                        netease only
                    </label>
                    <button type="button" className="underline opacity-70" onClick={clearCoverSizeSamples}>reset</button>
                </div>
            </div>

            {groups.length === 0 ? (
                <div className="px-3 py-3 text-[11px] opacity-70">
                    No cover requests seen yet. Browse the grid or the poster wall with an online provider signed in.
                </div>
            ) : (
                <div className="px-3 pb-3">
                    <div className="mt-2 overflow-x-auto">
                        <table className="w-full border-collapse text-[10px]">
                            <thead>
                                <tr className="opacity-60">
                                    <th className={`border px-2 py-1 text-left ${cellClass}`}>provider</th>
                                    <th className={`border px-2 py-1 text-right ${cellClass}`}>asked</th>
                                    <th className={`border px-2 py-1 text-left ${cellClass}`}>got</th>
                                    <th className={`border px-2 py-1 text-right ${cellClass}`}>urls</th>
                                    <th className={`border px-2 py-1 text-right ${cellClass}`}>measured</th>
                                    <th className={`border px-2 py-1 text-right ${cellClass}`}>median ms</th>
                                    <th className={`border px-2 py-1 text-right ${cellClass}`}>decoded</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map(group => {
                                    const verdict = verdictOf(group);
                                    return (
                                        <tr key={group.key}>
                                            <td className={`border px-2 py-1 ${cellClass}`}>{group.provider}</td>
                                            <td className={`border px-2 py-1 text-right ${cellClass}`}>
                                                {group.requested ?? '—'}
                                            </td>
                                            <td className={`border px-2 py-1 ${cellClass} ${toneClass[verdict.tone]}`}>
                                                {verdict.label}
                                            </td>
                                            <td className={`border px-2 py-1 text-right ${cellClass}`}>{group.count}</td>
                                            <td className={`border px-2 py-1 text-right ${cellClass}`}>{group.measured}</td>
                                            <td className={`border px-2 py-1 text-right ${cellClass}`}>
                                                {group.medianDurationMs.toFixed(0)}
                                            </td>
                                            <td className={`border px-2 py-1 text-right ${cellClass}`}>
                                                {formatMb(group.decodedBytes)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {ignored.length > 0 && (
                        <div className="mt-3">
                            <div className="text-[9px] uppercase tracking-[0.14em] text-amber-400">
                                Bigger than asked ({ignored.length})
                            </div>
                            <ul className="mt-1 grid gap-0.5">
                                {ignored.slice(0, MAX_IGNORED_SHOWN).map(sample => (
                                    <li key={sample.url} className="text-[10px] opacity-70 break-all">
                                        asked {sample.requested} · got {sample.delivered!.width}x{sample.delivered!.height}
                                        {' · '}
                                        <span className="opacity-60">{sample.url}</span>
                                    </li>
                                ))}
                            </ul>
                            <button
                                type="button"
                                className="mt-1 text-[10px] underline opacity-60"
                                onClick={() => { void copyText(ignored.map(sample => sample.url).join('\n')); }}
                            >
                                copy all {ignored.length}
                            </button>
                        </div>
                    )}

                    <div className="mt-2 text-[10px] opacity-55">
                        {totals.measured} of {totals.urls} URLs measured · {formatMb(totals.decodedBytes)} decoded
                        {totals.measured < totals.urls ? ', over the measured ones only' : ''}
                        {totals.urls >= MAX_TRACKED_URLS ? ' · at the tracking cap, oldest dropped' : ''}
                    </div>
                    <div className="mt-1 text-[10px] opacity-45">
                        Every column but urls covers the measured rows only; the rest are still being sized.
                        Decoded is width x height x 4 over distinct URLs, an upper bound rather than resident
                        memory, since Chromium drops decoded data and re-decodes on demand. Byte counts are
                        absent because cross-origin CDNs send no Timing-Allow-Origin. Rows are per provider
                        and requested size, not per surface: grids, the panel and the wall all land here.
                    </div>
                </div>
            )}
        </section>
    );
};

export default CoverSizeAuditPanel;

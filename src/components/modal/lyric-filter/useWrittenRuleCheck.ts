import { useEffect, useRef, useState } from 'react';
import { compileLyricLineRule, type LyricLineRule, type LyricLineRuleDraft } from '../../../utils/lyrics/lyricLineRules';
import type { LibraryScan, LibraryScanRequest } from './lyricLibraryScan';

// src/components/modal/lyric-filter/useWrittenRuleCheck.ts
// A written rule is the listener's own regular expression, and one badly written can hold a single
// test for minutes; nothing can interrupt it on the window's thread. So before the window tests a
// written rule there (the sample lyric, its card), it is run on the current song's lines in a
// lyricLibraryScan worker, which is stopped when the time runs out. A rule that ran out of time is
// not applied in the window, and Save is refused while it is on. Rules by words and presets are
// escaped words and are tested on the window's thread as they are.

/** How long a written rule may take on the current song's lines, counted from when the worker is ready. */
export const WRITTEN_RULE_LIMIT_MS = 100;

export type WrittenRuleVerdict = 'ok' | 'slow';

/** The expression of a rule to check before the window tests it, or null: not written, or it removes nothing. */
export const writtenRuleExpression = (rule: LyricLineRuleDraft): string | null => (
    rule.shape === 'written' && compileLyricLineRule(rule) ? rule.text.trim() : null
);

/** 'ok' when the window may test the rule on its own thread; 'checking' until its check is back; 'slow' when it ran out of time. */
export const writtenRuleState = (
    rule: LyricLineRuleDraft,
    verdicts: ReadonlyMap<string, WrittenRuleVerdict>,
): WrittenRuleVerdict | 'checking' => {
    const expression = writtenRuleExpression(rule);
    return expression === null ? 'ok' : verdicts.get(expression) ?? 'checking';
};

type CheckWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/**
 * Runs `expression` on `lines` in `worker` and calls `settle` once: 'ok' when it is back within
 * WRITTEN_RULE_LIMIT_MS, 'slow' when the time runs out first or the worker fails; the worker is
 * then stopped. An empty request goes first and the time starts when it comes back, so loading the
 * worker does not count. Returns a cancel, which stops the worker while the check still runs.
 */
export const checkWrittenRule = (
    worker: CheckWorker,
    expression: string,
    lines: readonly string[],
    settle: (verdict: WrittenRuleVerdict) => void,
): (() => void) => {
    let limit: ReturnType<typeof setTimeout> | undefined;
    let running = true;
    const finish = (verdict: WrittenRuleVerdict) => {
        running = false;
        clearTimeout(limit);
        if (verdict === 'slow') worker.terminate();
        settle(verdict);
    };
    worker.onmessage = (event: MessageEvent<LibraryScan>) => {
        if (!running || !event.data.complete) return;
        // The empty request is the only one with no song.
        if (event.data.total > 0) {
            finish('ok');
        } else {
            limit = setTimeout(() => {
                console.warn(`[LyricFilter] a written rule ran over ${WRITTEN_RULE_LIMIT_MS} ms on the current song: not applied`);
                finish('slow');
            }, WRITTEN_RULE_LIMIT_MS);
        }
    };
    worker.onerror = (event) => {
        console.warn('[LyricFilter] checking a written rule failed', event);
        if (running) finish('slow');
    };
    const ready: LibraryScanRequest = { songs: [], items: [], onRuleIds: [] };
    const check: LibraryScanRequest = {
        songs: [{ key: 'current', title: null, lines: [...lines] }],
        items: [{ rule: { id: 'check', on: true, shape: 'written', text: expression }, regex: new RegExp(expression) }],
        onRuleIds: [],
    };
    worker.postMessage(ready);
    worker.postMessage(check);
    return () => {
        if (!running) return;
        running = false;
        clearTimeout(limit);
        worker.terminate();
    };
};

export const NO_VERDICTS: ReadonlyMap<string, WrittenRuleVerdict> = new Map();

/** Per expression of `rules`, how its check on `lines` came out; one missing is still being checked. Nothing runs while the window is closed. */
export const useWrittenRuleCheck = (
    isOpen: boolean,
    lines: readonly string[],
    rules: readonly LyricLineRule[],
): ReadonlyMap<string, WrittenRuleVerdict> => {
    const [checked, setChecked] = useState({ lines, verdicts: NO_VERDICTS });
    const verdicts = checked.lines === lines ? checked.verdicts : NO_VERDICTS;
    const next = isOpen
        ? rules.map(writtenRuleExpression).find(expression => expression !== null && !verdicts.has(expression)) ?? null
        : null;
    // Kept between checks that came back in time while the window is open; a check stopped or still
    // running takes its worker with it.
    const worker = useRef<Worker | null>(null);

    useEffect(() => () => {
        worker.current?.terminate();
        worker.current = null;
    }, [isOpen]);

    useEffect(() => {
        if (next === null) {
            return undefined;
        }
        const held = worker.current ?? new Worker(new URL('./lyricLibraryScan.worker.ts', import.meta.url), { type: 'module' });
        worker.current = held;
        let settled = false;
        const cancel = checkWrittenRule(held, next, lines, (verdict) => {
            settled = true;
            if (verdict === 'slow' && worker.current === held) worker.current = null;
            setChecked(previous => ({
                lines,
                verdicts: new Map(previous.lines === lines ? previous.verdicts : []).set(next, verdict),
            }));
        });
        return () => {
            if (settled) return;
            cancel();
            if (worker.current === held) worker.current = null;
        };
    }, [lines, next]);

    return verdicts;
};

// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
const storage = vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
    return items;
});

import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumAccountState } from '@/mods/folium/contract';
import type { ProviderUser } from '@/types/onlineMusic';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { foliumAccountKeyOf, getFoliumAccountState, installFoliumHostAccount } from '@/mods/runtime/hostAccount';
import { createFoliumAccountService } from '@/mods/folium/account';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { createFoliumClientApi } from '@/mods/folium/api';
import { sha256Hex } from '@/utils/sha256';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumAccount.test.ts
// Folium 1.7 `folium.account` and `account.changed`: what a mod sees of the host's account store (no
// user id, cookie or token; an account key that stays put for one account and changes with it), and
// one event per provider per task, only when the status or the account changed.

installFoliumHostAccount();

const PROVIDER = 'netease';
const user = (id: number, nickname = 'listener'): ProviderUser => ({
    id,
    nickname,
    avatarUrl: 'https://img.example/avatar.jpg',
    backgroundUrl: 'https://img.example/bg.jpg',
    vipType: 11,
});
const store = () => useOnlineProviderAccountStore.getState();
const signIn = (id: number, nickname?: string) => store().updateAccount(PROVIDER, {
    status: 'authenticated',
    user: user(id, nickname),
    hydration: 'ready',
    freshness: 'fresh',
});
const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

const mod = (): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null,
});

beforeEach(async () => {
    store().setActiveProviderId(PROVIDER);
    store().clearAccount(PROVIDER);
    await flush();
});

afterEach(() => {
    removeFoliumEventHandlers('mod-a');
});

describe('sha256Hex', () => {
    it('matches Node for empty, block-edge and non-ASCII input', () => {
        for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(119), '网易云\n123', 'x'.repeat(1000)]) {
            expect(sha256Hex(text), `length ${text.length}`).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
        }
    });
});

describe('folium.account.getState', () => {
    it('projects the account without the user id, cookie or token', () => {
        signIn(9876543);
        const state = getFoliumAccountState(PROVIDER)!;
        expect(state).toEqual({
            providerId: PROVIDER,
            status: 'signed-in',
            user: { nickname: 'listener', avatarUrl: 'https://img.example/avatar.jpg' },
            accountKey: expect.stringMatching(/^[0-9a-f]{32}$/),
        });
        expect(JSON.stringify(state)).not.toContain('9876543');
        expect(JSON.stringify(state)).not.toMatch(/vip|background|cookie|token/i);
        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.user)).toBe(true);
    });

    it('reads the selected provider without an id, and null for a provider the host does not know', () => {
        signIn(1);
        expect(getFoliumAccountState()?.providerId).toBe(PROVIDER);
        expect(getFoliumAccountState('no-such-provider')).toBeNull();
    });

    it('reads nobody as signed out and an account not found out yet as unknown', () => {
        expect(getFoliumAccountState(PROVIDER)).toEqual({ providerId: PROVIDER, status: 'signed-out', user: null, accountKey: null });
        store().updateAccount(PROVIDER, { status: 'unknown', hydration: 'loading' });
        expect(getFoliumAccountState(PROVIDER)?.status).toBe('unknown');
        store().updateAccount(PROVIDER, { status: 'error', hydration: 'ready' });
        expect(getFoliumAccountState(PROVIDER)?.status).toBe('unknown');
        // A read that failed leaves the account shown: still signed in.
        signIn(5);
        store().updateAccount(PROVIDER, { status: 'error', freshness: 'error' });
        expect(getFoliumAccountState(PROVIDER)?.status).toBe('signed-in');
    });

    it('keeps one key per account, across restarts, and another for another account', () => {
        signIn(1);
        const first = getFoliumAccountState(PROVIDER)!.accountKey;
        signIn(1, 'renamed');
        expect(getFoliumAccountState(PROVIDER)!.accountKey).toBe(first);
        signIn(2);
        expect(getFoliumAccountState(PROVIDER)!.accountKey).not.toBe(first);
        expect(foliumAccountKeyOf('kugou', 1)).not.toBe(first);
        // The key is the digest of the kept salt, the provider and the user: a restart reads the same salt.
        const salt = storage.get('folia_folium_account_salt_v1');
        expect(salt).toMatch(/^[0-9a-f]{32}$/);
        expect(first).toBe(sha256Hex(`${salt}\n${PROVIDER}\n1`).slice(0, 32));
    });

    it('is the client API\'s `account`, and unavailable in the export window', () => {
        signIn(3);
        const api = createFoliumClientApi(mod(), clientApiOptions('main'));
        expect(api.account.getState(PROVIDER)?.status).toBe('signed-in');
        expect(api.account.getState(42 as unknown as string)).toBeNull();
        expect(() => createFoliumAccountService('export').getState()).toThrow('account-unavailable-in-export-context');
    });
});

describe('account.changed', () => {
    const listen = () => {
        const seen: FoliumAccountState[] = [];
        addFoliumEventHandler('mod-a', 'account.changed', (event) => { seen.push(event); });
        return seen;
    };

    it('announces a sign-in once for all the changes of a task', async () => {
        const seen = listen();
        // A sign-in clears the account, then fills it in.
        store().clearAccount(PROVIDER);
        store().updateAccount(PROVIDER, { status: 'unknown', hydration: 'loading' });
        signIn(7);
        expect(seen).toEqual([]);
        await flush();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual(getFoliumAccountState(PROVIDER));
        expect(seen[0].status).toBe('signed-in');
    });

    it('announces another account and a sign-out, and not a new nickname or a round trip', async () => {
        signIn(7);
        await flush();
        const seen = listen();
        signIn(7, 'new nickname');
        store().updateAccount(PROVIDER, { likedSongIds: [1, 2, 3] });
        await flush();
        expect(seen).toEqual([]);

        const before = getFoliumAccountState(PROVIDER)!.accountKey;
        signIn(8);
        await flush();
        expect(seen).toHaveLength(1);
        expect(seen[0].accountKey).not.toBe(before);

        // Signed out and back in within one task: where it began, so nothing.
        store().clearAccount(PROVIDER);
        signIn(8);
        await flush();
        expect(seen).toHaveLength(1);

        store().clearAccount(PROVIDER);
        await flush();
        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual({ providerId: PROVIDER, status: 'signed-out', user: null, accountKey: null });
    });

    it('tells a listener that came later nothing of what changed before it', async () => {
        signIn(11);
        await flush();
        const seen = listen();
        await flush();
        expect(seen).toEqual([]);
    });
});

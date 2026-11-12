import { create } from 'zustand';
import { omni } from '../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { RecommendationPreferenceEntry, RecommendationPreferences } from '../../types/onlineMusic';
import { changesOf, defaultDraftOf, draftOf, type PreferenceDraft } from './preferenceDraft';

// src/components/recommendationPreferences/useRecommendationPreferencesStore.ts
// 推荐偏好面板的状态：打开时读一次当前账号的偏好；「保存」交草稿，「重置」直接交默认值。
// 换了平台或账号、读或存的答复晚到，都不再写进面板；同一个账号同一时间只存一次。存过之后要不要重读每日推荐，由 omni 通知各处。

/** 偏好属于谁：已登录的平台加账号；没登录或平台不支持时是 null。 */
export const currentPreferencesOwner = (): string | null => {
    const { activeProviderId, accounts } = useOnlineProviderAccountStore.getState();
    const account = accounts[activeProviderId];
    if (account?.status !== 'authenticated' || !account.user) return null;
    if (!omni.supportsRecommendationPreferences()) return null;
    return `${activeProviderId}:${String(account.user.id)}`;
};

/** 账号这一侧变了（换平台、换账号、登出）的记号：面板开着时它一变就重读。 */
export const selectPreferencesAccountKey = (state: ReturnType<typeof useOnlineProviderAccountStore.getState>): string => {
    const account = state.accounts[state.activeProviderId];
    return `${state.activeProviderId}:${account?.status ?? 'unknown'}:${account?.user ? String(account.user.id) : ''}`;
};

/** 命令面板里「偏好设置」出现的条件。 */
export const isRecommendationPreferencesOffered = (): boolean => currentPreferencesOwner() !== null;

/** 平台声明了这个入口、而且现在能用。 */
export const offersRecommendationPreferencesAt = (entry: RecommendationPreferenceEntry): boolean => (
    isRecommendationPreferencesOffered() && omni.getRecommendationPreferenceEntries().includes(entry)
);

/** 一次保存的结果：确认了、存了但没确认、没有改动、失败、已经不是这个账号了、正在存。 */
export type PreferencesSaveOutcome = 'confirmed' | 'unconfirmed' | 'unchanged' | 'failed' | 'stale' | 'busy';

type RecommendationPreferencesState = {
    openTicket: number;
    owner: string | null;
    phase: 'idle' | 'loading' | 'ready' | 'failed';
    preferences: RecommendationPreferences | null;
    draft: PreferenceDraft;
    saving: boolean;
    open: () => Promise<void>;
    setValue: (key: string, value: string | number) => void;
    save: (intent?: 'reset') => Promise<PreferencesSaveOutcome>;
};

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

// 保存属于账号，不属于某次打开。等写入结束再读，避免重开时读到旧值。
const pendingSaves = new Map<string, Promise<void>>();

export const useRecommendationPreferencesStore = create<RecommendationPreferencesState>((set, get) => ({
    openTicket: 0,
    owner: null,
    phase: 'idle',
    preferences: null,
    draft: {},
    saving: false,

    open: async () => {
        // 每次重新读取都领一个号，晚到的读取和保存按它认出来。
        const mine = get().openTicket + 1;
        const owner = currentPreferencesOwner();
        const pending = owner ? pendingSaves.get(owner) : undefined;
        set({ openTicket: mine, owner, phase: owner ? 'loading' : 'idle', preferences: null, draft: {}, saving: Boolean(pending) });
        if (!owner) return;
        if (pending) {
            await pending;
            if (mine !== get().openTicket || currentPreferencesOwner() !== owner) return;
            set({ saving: false });
        }
        try {
            const preferences = await omni.getRecommendationPreferences();
            if (mine !== get().openTicket || currentPreferencesOwner() !== owner) return;
            console.info('[RecommendationPreferences] read', { items: preferences.items.length });
            set({ phase: 'ready', preferences, draft: draftOf(preferences.items) });
        } catch (error) {
            if (mine !== get().openTicket || currentPreferencesOwner() !== owner || isAbort(error)) return;
            console.warn('[RecommendationPreferences] read failed', error);
            set({ phase: 'failed' });
        }
    },

    setValue: (key, value) => {
        const { preferences, saving } = get();
        if (saving || !preferences?.items.some(item => item.key === key)) return;
        set(state => ({ draft: { ...state.draft, [key]: value } }));
    },

    save: async (intent) => {
        const { openTicket: mine, owner, preferences, draft, saving } = get();
        if (saving || (owner && pendingSaves.has(owner))) return 'busy';
        if (!owner || !preferences || currentPreferencesOwner() !== owner) return 'stale';
        const nextDraft = intent === 'reset' ? defaultDraftOf(preferences.items) : draft;
        const changes = changesOf(preferences.items, nextDraft);
        if (!Object.keys(changes).length) {
            if (intent === 'reset') set({ draft: nextDraft });
            return 'unchanged';
        }
        let finish: () => void = () => undefined;
        pendingSaves.set(owner, new Promise<void>(resolve => { finish = resolve; }));
        set({ saving: true, draft: nextDraft });
        try {
            const result = await omni.saveRecommendationPreferences(changes);
            console.info('[RecommendationPreferences] saved', { changed: Object.keys(changes).length, confirmed: result.confirmed });
            if (currentPreferencesOwner() !== owner) return 'stale';
            // 确认了才把这次的值当成账号现在的值；没确认就保持读到的，改动还在草稿里。
            if (mine === get().openTicket && result.confirmed) {
                set({
                    preferences: { ...preferences, items: preferences.items.map(item => (
                        Object.hasOwn(changes, item.key) ? { ...item, value: changes[item.key] } as typeof item : item
                    )) },
                });
            }
            return result.confirmed ? 'confirmed' : 'unconfirmed';
        } catch (error) {
            console.warn('[RecommendationPreferences] save failed', error);
            return isAbort(error) || currentPreferencesOwner() !== owner ? 'stale' : 'failed';
        } finally {
            pendingSaves.delete(owner);
            if (mine === get().openTicket) set({ saving: false });
            finish();
        }
    },
}));

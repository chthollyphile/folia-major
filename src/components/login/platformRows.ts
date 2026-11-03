import type { OnlineProviderId, ProviderAccountSummary } from '../../types/onlineMusic';

// src/components/login/platformRows.ts
// 一个平台作为一行时的规则，主页的登录按钮、切换器和登录窗口的那一列共用：它此刻是什么状态，
// 它们排成什么顺序，切换器上画哪一个。都是纯函数。

/** 一行（一个平台）此刻的状态。'off'：这个构建够不着它（没有配置），不能选。 */
export type RowStatus = 'signed-in' | 'ran-out' | 'signed-out' | 'accountless' | 'off';

export const rowStatus = (provider: ProviderAccountSummary): RowStatus => {
    if (!provider.availability.configured) return 'off';
    if (provider.requiresAccount === false) return 'accountless';
    if (provider.status === 'authenticated') return 'signed-in';
    return provider.error === 'auth-required' ? 'ran-out' : 'signed-out';
};

const RANK: Record<RowStatus, number> = { 'signed-in': 1, 'ran-out': 2, 'signed-out': 3, accountless: 3, off: 3 };

/**
 * 那一列的顺序：正在用的（也就是上次用的）平台在最前，然后是已登录的、登录失效的，其余按注册的顺序。
 * 这个运行环境根本用不了的平台（runtime-unavailable）不列出来。
 */
export const orderRows = (providers: readonly ProviderAccountSummary[], firstId: OnlineProviderId | null): ProviderAccountSummary[] => (
    providers
        .filter(provider => provider.availability.reason !== 'runtime-unavailable')
        .map((provider, index) => ({ provider, index, rank: provider.providerId === firstId ? 0 : RANK[rowStatus(provider)] }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(entry => entry.provider)
);

/**
 * 切换器上画的是哪个平台：那一列里第一个能选的，也就是正在用的那个；它用不了或者没有配置时，是已登录的、
 * 登录失效的、别的能选的，按那一列的顺序。一个能选的都没有才画不能选的第一个；一个都没有列出来是 null。
 */
export const pillProvider = (providers: readonly ProviderAccountSummary[], activeProviderId: OnlineProviderId): ProviderAccountSummary | null => {
    const rows = orderRows(providers, activeProviderId);
    return rows.find(row => rowStatus(row) !== 'off') ?? rows[0] ?? null;
};

/** 切换器一次画出来时知道的：画的是哪个平台，那里有没有人登录，这件事知不知道（启动时还在问就是不知道）。 */
export type PillSeen = { shownId: OnlineProviderId | undefined; signedIn: boolean; known: boolean };

/**
 * 平台的名字要不要在切换器旁边展开一会儿：换了平台，或者这个平台刚登录上。第一次画出来不算，退出登录不算，
 * 启动时刚读出记住的账号（上一次还不知道）也不算。
 */
export const pillNameUnfolds = (before: PillSeen, now: PillSeen): boolean => (
    before.known && (before.shownId !== now.shownId || (!before.signedIn && now.signedIn))
);

/**
 * 切换器又画了一次：它记下什么，名字展不展开。它画的这个平台的头像正从登录窗口飞过来的时候（`landing`），
 * 这一次不算看到：记着的还是之前的，等头像落下再拿它和那时的比，名字到那时才展开。
 */
export const pillSeenNext = (before: PillSeen, now: PillSeen, landing: boolean): { seen: PillSeen; unfolds: boolean } => (
    landing ? { seen: before, unfolds: false } : { seen: now, unfolds: pillNameUnfolds(before, now) }
);

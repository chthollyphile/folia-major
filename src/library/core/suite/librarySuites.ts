import type { LibraryAccountActionId } from '../account/account.contract';
import type { CollectionMutationCapabilities } from '../collection/mutations/mutations.contract';
import type {
    LibraryActionId,
    LibraryArtistActionId,
    LibraryDeclaredActions,
    LibraryHomeActionId,
    LibrarySuiteId,
    LibrarySuiteManifest,
    LibrarySuiteStageProps,
    LibrarySurfaceComponent,
    LibrarySurfaceDeclaration,
    LibrarySurfaceId,
    LibrarySurfacePropsMap,
} from './suite.contract';
import { assertLibrarySuiteChromeActions } from './suiteChrome';

// src/library/core/suite/librarySuites.ts
// suite 清单的纯规则：建索引（去重、默认 suite 必须实现全部 surface、丢掉不可用的）、按 surface 解析
// 「由哪套 suite 渲染」（没实现就回退默认 suite）、声明的动作与 core 能力取交集。
// registry.ts 只负责用 glob 发现 entry，再把清单交给这里；单测直接喂假清单。
// account surface（A5）同样整体回退：选中的 suite 没声明它就由网格的登录弹窗与确认框答复；声明了就必须列全
// 基础动作（LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS），缺了在建索引时抛错。

/** 默认 suite：任何 suite 没实现的 surface 都由它渲染，所以它必须实现全部 surface。 */
export const DEFAULT_LIBRARY_SUITE_ID: LibrarySuiteId = 'grid';

/** 没有构建变量覆盖时的初始选择：bravais（下一版起的默认，2026-10-10 用户定）。 */
const LIBRARY_SUITE_INITIAL_CHOICE_FALLBACK: LibrarySuiteId = 'bravais';

/**
 * 初始选择的取值：构建变量（VITE_LIBRARY_INITIAL_SUITE）给了非空值就用它，否则用内置的初始选择。
 * 这里不判断合法性——初始选择可以是当前构建里没有的 suite，渲染时照常经 registry 回退到默认 suite。
 */
export const resolveLibrarySuiteInitialChoice = (override: unknown): LibrarySuiteId => (
    typeof override === 'string' && override.trim() ? override.trim() : LIBRARY_SUITE_INITIAL_CHOICE_FALLBACK
);

/**
 * 初始选择：用户从没选过 suite（存储里没有记录）时 store 的初值。与默认 suite（回退 suite）是两回事：
 * 默认 suite 负责兜底渲染，初始选择只是「没选过的人先看到哪套」。测试配置用 VITE_LIBRARY_INITIAL_SUITE=grid 钉住。
 */
export const LIBRARY_SUITE_INITIAL_CHOICE: LibrarySuiteId = resolveLibrarySuiteInitialChoice(
    import.meta.env.VITE_LIBRARY_INITIAL_SUITE,
);

/** 可用的 suite 不止一套时才有得选（设置项、命令面板与 DEV 浮层都按它决定出不出现）。 */
export const isLibrarySuiteChoiceAvailable = (suites: readonly unknown[]): boolean => suites.length > 1;

export const LIBRARY_SURFACE_IDS: readonly LibrarySurfaceId[] = ['home', 'collection', 'artist', 'account'];

/** 集合 surface 的全部动作（与 LibraryActionId 一一对应，单测核对）。 */
export const LIBRARY_ACTION_IDS: readonly LibraryActionId[] = [
    'play',
    'enqueue',
    'play-scope',
    'enqueue-scope',
    'collect',
    'collect-scope',
    'save-to-playlist',
    'filter',
    'sort',
    'reload',
    'resume-sync',
    'remove-entry',
    'subscribe',
    'rename',
    'delete-collection',
    'resync-folder',
    'resync-all-folders',
    'export-playlist',
    'edit-entity',
    'set-cover',
    'organize-song-info',
    'match-song',
    'add-to-playlist',
    'create-playlist',
    'daily-date',
    'open-album',
    'open-artist',
];

/** 首页 surface 的全部动作（与 LibraryHomeActionId 一一对应，单测核对）。 */
export const LIBRARY_HOME_ACTION_IDS: readonly LibraryHomeActionId[] = [
    'directory-filter',
    'directory-select',
    'directory-play-selection',
    'directory-enqueue-selection',
    'directory-create-playlist',
    'directory-remove-selection',
    'directory-rescan-root',
    'directory-remove-root',
    'directory-clear-ignore',
    'directory-manage-hidden',
    'directory-toggle-hidden',
    'home-import-folder',
    'home-refresh-folders',
    'home-import-playlist',
    'home-refresh-navidrome',
];

/** 歌手页 surface 的全部动作（与 LibraryArtistActionId 一一对应，单测核对）。 */
export const LIBRARY_ARTIST_ACTION_IDS: readonly LibraryArtistActionId[] = [
    'play',
    'enqueue',
    'play-scope',
    'enqueue-scope',
    'filter',
    'reload',
    'resume-sync',
    'edit-entity',
    'open-album',
    'open-artist',
];

/** 账户 surface 的全部动作（与 LibraryAccountActionId 一一对应，单测核对）。 */
export const LIBRARY_ACCOUNT_ACTION_IDS: readonly LibraryAccountActionId[] = [
    'account-login',
    'account-login-method',
    'account-switch-confirm',
    'account-select',
    'account-logout',
    'account-login-diagnostics',
    'account-backend-restart',
];

/**
 * 声明了 account surface 就必须实现的基础动作：登录（二维码、状态、重试、关闭）、多方式 provider 的选方式、
 * 切换确认。它们会阻塞流程（必须有人答复），所以 account surface 不按动作逐项回退——少一个就是清单错误，
 * 建索引时抛错（与未知动作同样在启动时暴露），而不是悄悄把整个 surface 交回网格、让作者以为自己的界面在用。
 * 推荐动作（account-select / account-logout，首页账户列表）与可选动作（诊断、后端重启）没声明时那一项不显示。
 */
export const LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS: readonly LibraryAccountActionId[] = [
    'account-login',
    'account-login-method',
    'account-switch-confirm',
];

/** 每个 surface 的动作清单（建索引时按 surface 校验声明）。 */
const KNOWN_ACTIONS_BY_SURFACE: { readonly [Surface in LibrarySurfaceId]: readonly string[] } = {
    home: LIBRARY_HOME_ACTION_IDS,
    collection: LIBRARY_ACTION_IDS,
    artist: LIBRARY_ARTIST_ACTION_IDS,
    account: LIBRARY_ACCOUNT_ACTION_IDS,
};

/**
 * 由变更控制器判定的动作 → 它在 CollectionMutationCapabilities 里的能力键。没列出的动作（播放、范围、筛选、
 * 排序、重新拉取、续传）的能力来自资源与 useCollectionActions。editCollection 不对应动作：编辑模式属于
 * renderer（网格的局部动作 toggle-edit-mode）。
 */
export const LIBRARY_ACTION_MUTATION_CAPABILITY: {
    readonly [Action in LibraryActionId]?: Exclude<keyof CollectionMutationCapabilities, 'editCollection'>;
} = {
    'remove-entry': 'removeEntry',
    subscribe: 'subscribe',
    rename: 'rename',
    'delete-collection': 'deleteCollection',
    'resync-folder': 'resyncFolder',
    'resync-all-folders': 'resyncAllFolders',
    'export-playlist': 'exportPlaylist',
    'edit-entity': 'editEntity',
    'set-cover': 'setCover',
    'organize-song-info': 'organizeSongInfo',
    'match-song': 'matchSong',
    'add-to-playlist': 'addToPlaylist',
    'create-playlist': 'createPlaylist',
    'daily-date': 'dailyDate',
};

const NO_EXTRA_ACTIONS: readonly string[] = Object.freeze([]);

/** 一个 surface 由哪套 suite 渲染、它声明了什么。同一组输入总是返回同一个对象（可以直接当 props 传）。 */
export type ResolvedLibrarySuiteSurface<Surface extends LibrarySurfaceId> = {
    suite: LibrarySuiteManifest;
    declaration: LibrarySurfaceDeclaration<LibrarySurfacePropsMap[Surface]>;
    declaredActions: LibraryDeclaredActions;
    /** 选中的 suite 没实现这个 surface，由默认 suite 代为渲染。 */
    isFallback: boolean;
};

/** 生效 suite 的 stage（B1）。同一套 suite 总是同一个对象。 */
export type ResolvedLibrarySuiteStage = {
    suiteId: LibrarySuiteId;
    component: LibrarySurfaceComponent<LibrarySuiteStageProps>;
};

export type LibrarySuiteIndex = {
    /** 可用的 suite，默认 suite 在最前，其余按 id。 */
    suites: readonly LibrarySuiteManifest[];
    defaultSuite: LibrarySuiteManifest;
    has: (suiteId: string) => boolean;
    get: (suiteId: string) => LibrarySuiteManifest | undefined;
    /** 实际生效的 suite id：可用就是它自己，未知或当前构建不可用时是默认 suite。 */
    resolveId: (suiteId: string) => LibrarySuiteId;
    /** 选中的 suite 实现了就用它，否则（或 id 未知）回退默认 suite。 */
    resolve: <Surface extends LibrarySurfaceId>(surface: Surface, suiteId: string) => ResolvedLibrarySuiteSurface<Surface>;
    /**
     * 生效 suite 的 stage：先经 resolveId（未知或不可用的 id 是默认 suite），再看它有没有声明 stage；没有就是 null。
     * stage 不按 surface 回退——它属于整套 suite，选中的 suite 没有 stage 时不会借用默认 suite 的。
     */
    resolveStage: (suiteId: string) => ResolvedLibrarySuiteStage | null;
};

const toDeclaredActions = (declaration: LibrarySurfaceDeclaration<unknown>): LibraryDeclaredActions => Object.freeze({
    actions: declaration.actions,
    extraActions: declaration.extraActions ?? NO_EXTRA_ACTIONS,
});

/**
 * 建 suite 索引。清单有问题就在启动时抛错（而不是等到某个 surface 渲染时才发现）：重复 id、
 * 默认 suite 缺失或没实现全部 surface、声明了清单之外的动作。available === false 的 suite 被丢掉。
 * account surface 另要列全基础动作（LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS）；外观动作（chromeActions）按
 * ./suiteChrome 的 assertLibrarySuiteChromeActions 校验。
 */
export const buildLibrarySuiteIndex = (
    manifests: readonly LibrarySuiteManifest[],
    defaultSuiteId: LibrarySuiteId = DEFAULT_LIBRARY_SUITE_ID,
): LibrarySuiteIndex => {
    const byId = new Map<string, LibrarySuiteManifest>();
    for (const manifest of manifests) {
        if (byId.has(manifest.id)) {
            throw new Error(`[LibrarySuites] Duplicate suite id "${manifest.id}"`);
        }
        for (const surface of Object.keys(manifest.surfaces) as LibrarySurfaceId[]) {
            if (!LIBRARY_SURFACE_IDS.includes(surface)) {
                throw new Error(`[LibrarySuites] Suite "${manifest.id}" declares unknown surface "${surface}"`);
            }
            const known = KNOWN_ACTIONS_BY_SURFACE[surface];
            const declared: readonly string[] = manifest.surfaces[surface]?.actions ?? [];
            const unknownAction = declared.find(action => !known.includes(action));
            if (unknownAction) {
                throw new Error(`[LibrarySuites] Suite "${manifest.id}" declares unknown action "${unknownAction}" on ${surface}`);
            }
            const missingRequired = surface === 'account'
                ? LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS.filter(action => !declared.includes(action))
                : [];
            if (missingRequired.length > 0) {
                throw new Error(`[LibrarySuites] Suite "${manifest.id}" declares the account surface without the required action(s) ${missingRequired.join(', ')}`);
            }
        }
        assertLibrarySuiteChromeActions(manifest.id, manifest.chromeActions);
        if (manifest.available !== false) byId.set(manifest.id, manifest);
    }

    const defaultSuite = byId.get(defaultSuiteId);
    if (!defaultSuite) {
        throw new Error(`[LibrarySuites] Default suite "${defaultSuiteId}" is missing`);
    }
    const missing = LIBRARY_SURFACE_IDS.filter(surface => !defaultSuite.surfaces[surface]);
    if (missing.length > 0) {
        throw new Error(`[LibrarySuites] Default suite "${defaultSuiteId}" must implement every surface; missing ${missing.join(', ')}`);
    }

    const suites = [
        defaultSuite,
        ...[...byId.values()].filter(suite => suite !== defaultSuite).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ];

    // 预先算好每个 (suite, surface) 的解析结果：宿主每次渲染都会问，答案必须是同一个对象。
    const resolved = new Map<string, Map<LibrarySurfaceId, ResolvedLibrarySuiteSurface<LibrarySurfaceId>>>();
    for (const suite of suites) {
        const perSurface = new Map<LibrarySurfaceId, ResolvedLibrarySuiteSurface<LibrarySurfaceId>>();
        for (const surface of LIBRARY_SURFACE_IDS) {
            const own = suite.surfaces[surface];
            const renderer = own ? suite : defaultSuite;
            const declaration = (own ?? defaultSuite.surfaces[surface]!) as LibrarySurfaceDeclaration<unknown>;
            const shared = resolved.get(renderer.id)?.get(surface);
            perSurface.set(surface, {
                suite: renderer,
                declaration: declaration as ResolvedLibrarySuiteSurface<LibrarySurfaceId>['declaration'],
                // 回退时与默认 suite 自己的解析共用同一份声明对象。
                declaredActions: shared?.declaredActions ?? toDeclaredActions(declaration),
                isFallback: !own,
            });
        }
        resolved.set(suite.id, perSurface);
    }
    const stages = new Map<string, ResolvedLibrarySuiteStage>();
    for (const suite of suites) {
        if (suite.stage) stages.set(suite.id, Object.freeze({ suiteId: suite.id, component: suite.stage }));
    }
    const resolveId = (suiteId: string): LibrarySuiteId => (byId.has(suiteId) ? suiteId : defaultSuite.id);

    return {
        suites,
        defaultSuite,
        has: suiteId => byId.has(suiteId),
        get: suiteId => byId.get(suiteId),
        resolveId,
        resolve: <Surface extends LibrarySurfaceId>(surface: Surface, suiteId: string) => (
            (resolved.get(suiteId) ?? resolved.get(defaultSuite.id)!).get(surface) as unknown as ResolvedLibrarySuiteSurface<Surface>
        ),
        resolveStage: suiteId => stages.get(resolveId(suiteId)) ?? null,
    };
};

/**
 * 声明 ∩ core 能力：available 是 core 此刻认为能做的动作，只留下 suite 也声明了的，顺序按 available。
 */
export const intersectDeclaredActions = (
    declared: LibraryDeclaredActions,
    available: readonly LibraryActionId[],
): LibraryActionId[] => available.filter(action => declared.actions.includes(action));

/**
 * 变更控制器判定的那部分动作：suite 声明了、且这个集合支持的（不看 enabled——进行中、加载中的动作
 * 仍然出现，只是不可用）。suite 用它决定自己的变更入口出不出现（TUI 的 Delete、星标、改名……）；
 * 命令面板走 core/collection/collectionSurface 的 GRID_SURFACE_ACTION_SOURCES，结果与这里一致。
 */
export const resolveDeclaredMutationActions = (
    declared: LibraryDeclaredActions,
    capabilities: CollectionMutationCapabilities,
): LibraryActionId[] => declared.actions.filter((action): action is LibraryActionId => {
    const key = LIBRARY_ACTION_MUTATION_CAPABILITY[action as LibraryActionId];
    return key ? capabilities[key].supported : false;
});

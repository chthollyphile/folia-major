import { PLAYBACK_PATH_FILES } from './playbackTokens.mjs';
// dev/dedicatus/restrictedApis.mjs
// 限制写法的登记表：某些 API 只能在少数几个地方用。每条写法用 esquery 选择器描述，按文件路径决定在哪里生效，
// 由本地规则 dedicatus/restricted-apis 检查（dev/dedicatus/eslint/plugin.mjs）。放在一张表里而不是用
// ESLint 自带的 no-restricted-*：那几条规则在不同配置块里的选项会互相覆盖。
// exclude 里每个例外都要写原因；新加例外要改这张表，审查时看得见。

/**
 * @typedef {{ code: string, message: string, selectors: string[], include: string[], exclude?: { path: string, why: string }[] }} RestrictedApi
 * @type {RestrictedApi[]}
 */
export const RESTRICTED_APIS = [
    {
        code: 'D312',
        message: '判断“等待期间队列有没有被换掉”不比较 playQueue 的引用：加入、删除、重排、本地库刷新都会换引用，补歌和模式切换会被静默丢掉（#760）。用 wholeQueueWritesSoFar()、queueStartsSoFar() 或起播令牌。',
        selectors: [
            "BinaryExpression[operator=/^[!=]==$/] > Identifier[name='playQueue']",
            "BinaryExpression[operator=/^[!=]==$/] > MemberExpression[property.name='playQueue']",
        ],
        include: PLAYBACK_PATH_FILES,
    },
    {
        code: 'D508',
        message: '不直接读写 localStorage / sessionStorage，用 src/stores/storagePrimitives.ts（读写失败、隐私模式、Node 差异都在那里处理）。',
        selectors: [
            'Identifier[name=/^(localStorage|sessionStorage)$/]:not(MemberExpression[computed=false] > Identifier.property):not(Property > Identifier.key):not(TSPropertySignature > Identifier.key)',
            'MemberExpression[computed=false][object.name=/^(window|globalThis|self)$/][property.name=/^(localStorage|sessionStorage)$/]',
        ],
        include: ['src/**'],
        exclude: [
            { path: 'src/stores/storagePrimitives.ts', why: '存储读写的原语本身' },
            { path: 'src/components/**', why: '组件里由 D411 管（含义是“组件直读存储”），不重复报' },
            { path: 'src/**/*.d.ts', why: '类型声明' },
        ],
    },
    {
        code: 'D606',
        message: '不用 (window as any).electron 绕过类型：在 src/vite-env.d.ts 的 window.electron 里声明这个方法，让 preload、主进程、类型三处对得上（#874）。',
        selectors: ["MemberExpression[property.name='electron'] > TSAsExpression.object[typeAnnotation.type='TSAnyKeyword'][expression.name='window']"],
        include: ['src/**'],
    },
    {
        code: 'D607',
        message: '不用同步 IPC：渲染层的 sendSync 会卡住主线程等主进程（#874）；状态查询改用 invoke。',
        selectors: [
            "MemberExpression[computed=false][property.name='sendSync']",
            "AssignmentExpression > MemberExpression.left[computed=false][property.name='returnValue']",
        ],
        include: ['electron/**', 'src/**'],
    },
    {
        code: 'D608',
        message: '系统加密能不能用，一律经 electron/osEncryption.cjs 判断（含 Linux basic_text），各仓库的判断才一致。',
        selectors: [
            "MemberExpression[computed=false][object.name='safeStorage'][property.name=/^(isEncryptionAvailable|getSelectedStorageBackend)$/]",
        ],
        include: ['electron/**'],
        exclude: [
            { path: 'electron/osEncryption.cjs', why: '统一的判断本身' },
            { path: 'electron/aiCredentialStore.cjs', why: '#594：Linux 没有系统钥匙串（basic_text）时 AI 密钥刻意保持明文，和其他凭据仓库相反（维护者 2026-11-08 确认保留）' },
            { path: 'electron/loginBackendIpc.cjs', why: '登录自检只读出加密后端的状态写进诊断报告，不据此决定加不加密' },
        ],
    },
    {
        code: 'D609',
        message: '外链只经协议白名单打开：主进程用 electron/externalUrlPolicy.cjs 的 openExternalUrl，渲染层用 src/utils/system/outsideLink.ts 的 openOutsideLink（#615）。',
        selectors: [
            "MemberExpression[computed=false][object.name='shell'][property.name='openExternal']",
        ],
        include: ['electron/**'],
        exclude: [{ path: 'electron/externalUrlPolicy.cjs', why: '协议白名单本身' }],
    },
    {
        code: 'D609',
        message: '外链只经协议白名单打开：渲染层用 src/utils/system/outsideLink.ts 的 openOutsideLink，不直接 window.open 或 window.electron.openExternalUrl（#615）。',
        selectors: [
            "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(window|globalThis)$/][callee.property.name='open']",
            "MemberExpression[computed=false][property.name='openExternalUrl']",
        ],
        include: ['src/**'],
        exclude: [
            { path: 'src/utils/system/outsideLink.ts', why: '统一的外链入口本身' },
            { path: 'src/**/*.d.ts', why: '类型声明' },
        ],
    },
    {
        code: 'D445',
        message: '按词切分歌词用 src/utils/lyrics/icuFolia/segmenter.ts（segmentLyricWords / segmentTextWords），不另建 granularity: word 的分割器：用户的精细分词才能一次覆盖所有模式。',
        selectors: [
            "NewExpression > ObjectExpression.arguments > Property[key.name='granularity'][value.value='word']",
        ],
        include: ['src/**'],
        exclude: [
            { path: 'src/utils/lyrics/icuFolia/segmenter.ts', why: '统一的分词器本身' },
            { path: 'src/library/suites/bravais/BravaisSeamPoster.tsx', why: '海报标题排版，不是歌词' },
        ],
    },
];

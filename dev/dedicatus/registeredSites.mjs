// dev/dedicatus/registeredSites.mjs
// 登记过的写入点：某种写法只能出现在登记过的文件（allowFiles），或登记过的“文件 → 函数”（sites）里。
// 由本地规则 dedicatus/registered-sites 检查（dev/dedicatus/eslint/plugin.mjs），按所在的有名字的函数放行
// （匿名回调算外层函数）。每个登记都写原因；新加一处要改这张表，审查时看得见。

/**
 * @typedef {{ code: string, message: string, selectors: string[], include: string[],
 *   allowFiles?: { path: string, why: string }[], sites?: Record<string, Record<string, string>>, allowInsideDevGuard?: boolean }} RegisteredSite
 * @type {RegisteredSite[]}
 */
export const REGISTERED_SITES = [
    {
        code: 'D121',
        message: '“已下架”只能来自平台明确的下架记录：会员、地区、网络失败、空地址、空答复都不能推断成下架（#619、#891）。在登记的函数里给出，并写明依据的平台字段',
        // 'taken-down' 出现在任何给出值的位置（对象的值、return、箭头函数的返回值、变量、成员赋值、三元的一支、
        // 交给别的函数……）；读不算：比较（=== 'taken-down'、case 'taken-down':）、数组元素、对象的键和下标（TEXTS['taken-down']）、
        // 类型，以及交给查询函数（.includes / .has / .get / .indexOf…，isX / hasX）。
        // 静态的 state: 'unavailable' 只认对象的值和成员赋值（'unavailable' 这个词在别处还有别的意思）。
        selectors: [
            "Literal[value='taken-down']:not(BinaryExpression > Literal, SwitchCase > Literal.test, Property > Literal.key, ArrayExpression > Literal, TSLiteralType > Literal, TSEnumMember > Literal, MemberExpression[computed=true] > Literal.property, CallExpression[callee.property.name=/^(includes|has|get|indexOf|lastIndexOf|startsWith|endsWith|delete)$/] > Literal, CallExpression[callee.name=/^(is|has)[A-Z]/] > Literal, CallExpression[callee.property.name=/^(is|has)[A-Z]/] > Literal)",
            "Property[key.name='state'] > Literal.value[value='unavailable']",
            "Property[key.name='state'] > ConditionalExpression.value > Literal[value='unavailable']",
            "AssignmentExpression[left.property.name='state'] > Literal.right[value='unavailable']",
        ],
        include: ['src/**', 'electron/**'],
        allowFiles: [
            { path: 'src/types/**', why: '类型与契约' },
            { path: 'src/services/onlineMusic/failure/onlineFailureCase.ts', why: '失败种类的行为表，不判断是不是下架' },
            { path: 'src/services/onlineMusic/failure/onlineFailureTexts.ts', why: '文案表' },
            { path: 'src/services/onlineMusic/spotify/spotifyFailure.ts', why: 'Spotify 自己的播放器报 ONE_TRACK_UNPLAYABLE、理由是 NOT_AVAILABLE_*：平台自己说了这首放不了，这张表只是把那个理由翻成失败种类，不自己判断' },
            { path: 'src/mods/folium/**', why: 'Folium 的契约和 DTO：把已经确定的状态原样透传给模组' },
            { path: 'src/mods/runtime/omni/omniDto.ts', why: '把已经确定的可用性映射成模组看到的值，不自己判断' },
        ],
        sites: {
            'src/services/onlineMusic/netease/netease.ts': { resolveNeteaseSongAvailability: 'privilege.st 是网易云的下架码（NETEASE_TAKEN_DOWN_ST），且没有可播的音质、不是云盘' },
            'src/services/onlineMusic/bodian/bodianProvider.ts': { getAvailability: '波点自己标的 off-shelf' },
            'src/components/app/playback/start/usePlaybackQueueController.ts': { playSong: '只在 isSongUnavailable(song) 为真时：那是 provider 依据平台记录给的静态可用性，这里只是呈现' },
        },
    },
    {
        code: 'D120',
        message: 'provider 只有真正读完了才能回 whole: true；中途某页失败、只读了一部分要抛 OnlineProviderError 或回 whole: false（#874、#1069），否则没读到的数据会被当成已删除',
        selectors: ["Property[key.name='whole'] > Literal.value[value=true]"],
        include: ['src/services/onlineMusic/**'],
        sites: {
            'src/services/onlineMusic/kugou/kugouProvider.ts': { getLikedSongIds: 'getKugouLikedPlaylistTracks 读到底，读不完就抛错' },
            'src/services/onlineMusic/netease/neteaseProvider.ts': { getLikedSongIds: '一次请求就是整张列表；出错的答复先抛 OnlineProviderError' },
        },
    },
    {
        code: 'D442',
        message: '调试挂件（window.__*、globalThis.__* 赋值）只能放在 src/dev/ 里，或者 import.meta.env.DEV 守卫的分支里，不能进正式包（#987、#304）',
        // `window.__x =`、`window['__x'] =`、`(window as …).__x =`（TS 里最常见的写法，#987 原代码就是这样）、
        // `Object.assign(window, { __x })`
        selectors: [
            'AssignmentExpression > MemberExpression.left:matches([property.name=/^__/], [property.value=/^__/]):matches([object.name=/^(window|globalThis|self)$/], [object.expression.name=/^(window|globalThis|self)$/], [object.expression.expression.name=/^(window|globalThis|self)$/])',
            "CallExpression[callee.object.name='Object'][callee.property.name='assign']:matches([arguments.0.name=/^(window|globalThis|self)$/], [arguments.0.expression.name=/^(window|globalThis|self)$/], [arguments.0.expression.expression.name=/^(window|globalThis|self)$/]) > ObjectExpression > Property[key.name=/^__/]",
        ],
        include: ['src/**'],
        allowFiles: [{ path: 'src/dev/**', why: '开发专用代码' }],
        allowInsideDevGuard: true,
        sites: {
            'src/components/visualizer/machi/createMachiRuntime.ts': { installDebugHook: '只在 import.meta.env.DEV 时调用（调用处守卫）' },
            'src/services/beatFx/beatFxLive.ts': { '(module)': 'debug 只在 DEV 或用户打开调试开关（readDebugFlag）时存在' },
            'src/mods/export/modExportPage.tsx': { ModExportPage: '不是调试挂件：导出窗口和主进程 exportService.cjs 之间的协议（executeJavaScript 调 window.__foliaModExport）' },
        },
    },
];

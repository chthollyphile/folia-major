// dev/dedicatus/credentialWriters.mjs
// D604 的登记表：账号凭据（代表“谁登录着”的 token、userid、cookie）只能在这里登记过的函数里写，
// 每个函数还限定它能写哪几个键。规则在 dev/dedicatus/eslint/plugin.mjs 的 credential-write-sites。
//
// 为什么要登记：#1104 的会话被“公开歌单创建者的 userid”盖掉，就是因为处理每一个响应的函数都能写账号字段。
// 登记表让“谁能改登录账号”变成几个小而专一的入口；新加一处写入要改这张表，审查时一眼能看到。
// 登记的函数要满足其一，并在说明里写清楚是哪一种：只在确认的登录（或同一会话的续期）之后被调用；
// 或者函数自己挡掉账号项，只写别的。
//
// 检查范围：渲染进程经 providerStorage 写的会话值，和酷狗桥接层的会话 cookie 对象（含整个重新赋值）。
// 其他平台主进程里的会话仓库（spotify、ytm、qishui、bodian、fnmusic、QQ 包内部）还没纳入。

/** 算作账号凭据的键。设备 id（dfid）、匿名会话（anonymous_cookie）不算。 */
export const CREDENTIAL_KEYS = ['token', 'userid', 'user_id', 'cookie'];

/** 写凭据的函数：`writeProviderSessionValue(平台, 键, 值)`（改名导入也认）。 */
export const CREDENTIAL_WRITE_CALLS = ['writeProviderSessionValue'];
/** 直接写 localStorage 时拼会话键的函数：`localStorage.setItem(getProviderSessionKey(平台, 键), 值)` 也算写凭据。 */
export const CREDENTIAL_STORAGE_KEY_CALLS = ['getProviderSessionKey'];
/**
 * 文件 → 会话 cookie 对象的名字，以及返回它的函数（`const jar = ensureCookies()` 这样的别名也认）。
 * 只在登记的文件里认：别处叫 cookies 的变量和登录会话无关。
 */
export const CREDENTIAL_OBJECTS = { 'electron/kugou/kugouApiBridge.cjs': ['sessionCookies', 'cookies'] };
export const CREDENTIAL_OBJECT_FACTORIES = { 'electron/kugou/kugouApiBridge.cjs': ['ensureCookies'] };

/**
 * 文件 → 函数 → 允许写的键。`*` 只放行运行时才知道的键（`obj[key] = …`），登记了它的函数要自己挡掉账号项。
 * @type {Record<string, Record<string, string[]>>}
 */
export const CREDENTIAL_WRITERS = {
    'src/services/onlineMusic/providerStorage.ts': {
        // 会话值的存取原语本身：键由调用方给，调用方受这张表约束
        writeProviderSessionValue: ['*'],
    },
    'src/services/onlineMusic/kugou/kugouTransport.ts': {
        // 确认的扫码登录（status 4）带来的 cookie 和账号，token 与 userid 整对写入
        rememberConfirmedSignIn: ['token', 'userid', 'cookie'],
        // 其他响应带回的 cookie：函数自己去掉账号项
        rememberSessionCookies: ['cookie'],
        // 桌面版的账号提示：只从确认的登录和 user_detail（桥接层填的是会话自己的账号）调用
        rememberSignedInAccountId: ['userid'],
        // 清掉设备 id，其余 cookie 原样写回
        clearWebDeviceIdentity: ['cookie'],
    },
    'src/services/onlineMusic/qq/qqTransport.ts': {
        // 只在 login_qr_check 确认（code 803）时写
        persistConfirmedSession: ['cookie'],
    },
    'src/services/onlineMusic/qq/qqProvider.ts': {
        // 扫码轮询确认（803）的分支
        checkLogin: ['cookie'],
    },
    'src/services/onlineMusic/qq/qqSessionRefresh.ts': {
        // 同一个会话的续期：轮换出的新 token，换账号或退出后不写
        refreshOnce: ['cookie'],
    },
    'src/services/onlineMusic/netease/neteaseProvider.ts': {
        // 扫码轮询确认（803）的分支
        checkLogin: ['cookie'],
    },
    'electron/kugou/kugouApiBridge.cjs': {
        // 确认的扫码登录（login_qr_check、status 4），整对写入
        adoptConfirmedSignIn: ['token', 'userid'],
        // 响应带回的设备 cookie：函数自己挡掉账号 cookie
        rememberDeviceCookie: ['*'],
        // 第一次用时载入存着的会话（或者一套新的设备 cookie）
        ensureCookies: ['*'],
        // 退出登录：整个换成去掉了账号和设备凭据的 cookie
        dropAccountCookies: ['*'],
    },
};

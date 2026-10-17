const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

// electron/soda/sodaSigner.cjs
//
// 用汽水官方客户端自带的原生模块 bdms.node 生成应用级请求签名（X-Helios / X-Medusa）。
// 没有这对头，`POST /luna/pc/track_v2` 会返回 HTTP 200 + 空 body：接口还在，风控把响应挖空了。
//
// 做法与 sodahub-org/libmssdk 相同，只是不另起服务：Folia 的主进程就是 Node，直接 require 那个 .node。
// 模块和 metasecml.dll 必须同目录，所以只从客户端安装路径加载，不复制、不分发。
//
// 官方用法（见客户端 sourcemap 泄漏的 src/app.ts）：
//   bdms.init({ deviceId })
//   bdms.generateHttpSignatureHeaders(url, '名字\r\n值\r\n…').split('\r\n') → 成对的 name/value

const CLIENT_ROOTS = [
    () => path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Soda Music'),
    () => path.join(process.env.LOCALAPPDATA || '', 'Soda Music'),
    () => path.join(process.env.PROGRAMFILES || '', 'Soda Music'),
];

const MODULE_RELATIVE = path.join('resources', 'app.asar.unpacked', 'bdms.node');

/** 从安装目录里找 bdms.node：先按版本号排，取最新的那个。 */
function findBdmsModule() {
    for (const make of CLIENT_ROOTS) {
        const root = make();
        if (!root || !existsSync(root)) continue;
        let versions = [];
        try {
            versions = readdirSync(root, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        } catch {
            continue;
        }
        for (const version of versions) {
            const candidate = path.join(root, version, MODULE_RELATIVE);
            if (existsSync(candidate)) return candidate;
        }
    }
    return '';
}

/** 官方约定：headers 展平成 "名字\r\n值\r\n名字\r\n值…"。 */
const flattenHeaders = (headers) => Object.entries(headers)
    .filter(([name, value]) => name && value !== undefined && value !== null)
    .map(([name, value]) => `${name}\r\n${value}`)
    .join('\r\n');

const parseSignaturePairs = (raw) => {
    const fields = String(raw || '').split('\r\n').filter((item) => item.trim());
    const out = {};
    for (let index = 0; index + 1 < fields.length; index += 2) out[fields[index]] = fields[index + 1];
    return out;
};

const deviceIdFrom = (url, headers = {}) => {
    const direct = headers.device_id || headers['device-id'] || headers['Device-Id'];
    if (direct) return String(direct).trim();
    try {
        const parsed = new URL(String(url));
        for (const key of ['device_id', 'fp', 'did']) {
            const value = parsed.searchParams.get(key);
            if (value) return value.trim();
        }
    } catch { /* 地址不合法就算了 */ }
    return '';
};

const md5Upper = (text) => createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();

function createSodaSigner({ warn = console.warn } = {}) {
    let module = null;
    let modulePath = '';
    let boundDeviceId = '';
    let failure = '';

    const load = () => {
        if (module) return module;
        if (failure) throw new Error(failure);
        modulePath = findBdmsModule();
        if (!modulePath) {
            failure = '没有找到汽水客户端自带的 bdms.node';
            throw new Error(failure);
        }
        try {
            module = require(modulePath);
        } catch (error) {
            failure = `bdms.node 加载失败：${error?.message || error}`;
            throw new Error(failure);
        }
        if (typeof module.init !== 'function' || typeof module.generateHttpSignatureHeaders !== 'function') {
            failure = 'bdms.node 导出的接口和预期不符（需要 init / generateHttpSignatureHeaders）';
            throw new Error(failure);
        }
        console.info('[Soda] bdms loaded:', modulePath);
        return module;
    };

    const ensureInit = (deviceId) => {
        const bdms = load();
        const target = String(deviceId || '').trim();
        if (!target) throw new Error('签名需要 device_id');
        if (boundDeviceId === target) return bdms;
        bdms.init({ deviceId: target });
        boundDeviceId = target;
        return bdms;
    };

    return {
        get available() {
            try {
                load();
                return true;
            } catch {
                return false;
            }
        },
        get reason() {
            return failure;
        },
        get modulePath() {
            return modulePath || findBdmsModule();
        },

        /** 给一次要发出去的请求签名，返回要附加的头。headers 必须是真实要发的那一份。 */
        sign({ url, headers = {}, deviceId = '' } = {}) {
            if (!url) throw new Error('签名需要 url');
            const target = deviceId || deviceIdFrom(url, headers);
            const bdms = ensureInit(target);
            const signed = parseSignaturePairs(bdms.generateHttpSignatureHeaders(String(url), flattenHeaders(headers)));
            const names = Object.keys(signed);
            const has = (name) => names.some((item) => item.toLowerCase() === name);
            if (!has('x-helios') || !has('x-medusa')) {
                throw new Error(`签名不完整：只拿到 ${names.length} 个头（${names.join(',') || '空'}）`);
            }
            return signed;
        },
    };
}

module.exports = { createSodaSigner, findBdmsModule, flattenHeaders, md5Upper };

'use strict';

const fs = require('fs');
const path = require('path');

// 主进程从系统文件框拿到的手动 mpv 路径，单独存在 userData/hifi-runtime/ 下的一个小 JSON 里：通用的
// save-settings 只写共享的 electron-store，碰不到这里，主窗口里被注入的脚本没法自己批准一个程序给主进程运行。

const APPROVED_PATH_SEGMENTS = Object.freeze(['hifi-runtime', 'approved-mpv-path.json']);
/**
 * 早先存这份批准的 electron-store 键。save-settings 能写它，所以里面的值不一定出自文件框：不再读它、
 * 也不搬过来（分不清是谁写的），save-settings 拒写。
 */
const LEGACY_MANUAL_PATH_SETTING_KEY = 'hifi_mpv_manual_path';

/** save-settings 不许写的键（主进程自己管的 HiFi 状态）。 */
const isReservedHifiSettingKey = key => key === LEGACY_MANUAL_PATH_SETTING_KEY;

/**
 * 批准路径的读写：get() 没存过时为 null，文件坏了就抛（调用方记一行、当成没批准）；set(null) 删掉文件。
 * 先写临时文件再改名，写到一半退出不会留下半个 JSON。
 */
const createApprovedMpvPathStore = ({ getUserDataPath, fsModule = fs, pathModule = path } = {}) => {
    if (typeof getUserDataPath !== 'function') throw new TypeError('HiFi approved mpv path store needs getUserDataPath');
    const filePath = () => pathModule.join(getUserDataPath(), ...APPROVED_PATH_SEGMENTS);

    const get = () => {
        let text;
        try {
            text = fsModule.readFileSync(filePath(), 'utf8');
        } catch (error) {
            if (error && error.code === 'ENOENT') return null;
            throw error;
        }
        const parsed = JSON.parse(text);
        return parsed && typeof parsed.path === 'string' ? parsed.path : null;
    };

    const set = value => {
        const target = filePath();
        if (value === null) {
            fsModule.rmSync(target, { force: true });
            return;
        }
        if (typeof value !== 'string') throw new TypeError('HiFi approved mpv path must be a string or null');
        fsModule.mkdirSync(pathModule.dirname(target), { recursive: true });
        const staging = `${target}.tmp`;
        fsModule.writeFileSync(staging, `${JSON.stringify({ path: value })}\n`, 'utf8');
        fsModule.renameSync(staging, target);
    };

    return { get, set, filePath };
};

module.exports = {
    APPROVED_PATH_SEGMENTS,
    LEGACY_MANUAL_PATH_SETTING_KEY,
    isReservedHifiSettingKey,
    createApprovedMpvPathStore,
};

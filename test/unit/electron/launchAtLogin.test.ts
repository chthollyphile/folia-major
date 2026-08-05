import { describe, expect, it } from 'vitest';

// test/unit/electron/launchAtLogin.test.ts
// 锁定开机自启的平台支持范围、开发态入口路径处理，以及读写参数的对称性。

type LoginItemQuery = { path?: string; args?: string[] };

const {
    isLaunchAtLoginSupported,
    buildLoginItemQuery,
    buildLoginItemSettings,
} = require('../../../electron/launchAtLogin.cjs') as {
    isLaunchAtLoginSupported: (platform: string) => boolean;
    buildLoginItemQuery: (input: {
        execPath: string;
        isPackaged: boolean;
        appPath?: string;
    }) => LoginItemQuery;
    buildLoginItemSettings: (input: {
        enabled: boolean;
        execPath: string;
        isPackaged: boolean;
        appPath?: string;
    }) => { openAtLogin: boolean; openAsHidden: boolean } & LoginItemQuery;
};

const devContext = {
    execPath: 'C:/repo/node_modules/electron/dist/electron.exe',
    isPackaged: false,
    appPath: 'C:/repo',
};

const packagedContext = {
    execPath: 'C:/Program Files/Folia/Folia.exe',
    isPackaged: true,
    appPath: 'C:/Program Files/Folia/resources/app.asar',
};

describe('isLaunchAtLoginSupported', () => {
    it('在 macOS 与 Windows 上受支持', () => {
        expect(isLaunchAtLoginSupported('darwin')).toBe(true);
        expect(isLaunchAtLoginSupported('win32')).toBe(true);
    });

    it('Linux 不受支持，需要用户自建 autostart 项', () => {
        expect(isLaunchAtLoginSupported('linux')).toBe(false);
    });
});

describe('buildLoginItemSettings', () => {
    it('打包后直接使用默认入口，不写死路径', () => {
        expect(buildLoginItemSettings({ enabled: true, ...packagedContext }))
            .toEqual({ openAtLogin: true, openAsHidden: false });
    });

    it('开发态显式带上应用入口，避免注册成 Electron 本体', () => {
        const settings = buildLoginItemSettings({ enabled: true, ...devContext });

        expect(settings.path).toBe(devContext.execPath);
        expect(settings.args).toEqual([devContext.appPath]);
    });

    it('关闭时同样返回 openAtLogin: false', () => {
        expect(buildLoginItemSettings({ enabled: false, ...packagedContext }).openAtLogin).toBe(false);
    });
});

// Windows 的 getLoginItemSettings 按 path + args 比对注册项：
// 写入带 path/args 而读取不带，会匹配不到刚写入的记录并误报未开启。
describe('buildLoginItemQuery 与写入参数保持对称', () => {
    it('开发态查询参数与写入的 path / args 完全一致', () => {
        const written = buildLoginItemSettings({ enabled: true, ...devContext });
        const query = buildLoginItemQuery(devContext);

        expect(query).toEqual({ path: written.path, args: written.args });
    });

    it('打包态两边都不带定位参数', () => {
        const written = buildLoginItemSettings({ enabled: true, ...packagedContext });

        expect(buildLoginItemQuery(packagedContext)).toEqual({});
        expect(written.path).toBeUndefined();
        expect(written.args).toBeUndefined();
    });

    it('缺少 appPath 时退回默认定位，不构造半截参数', () => {
        expect(buildLoginItemQuery({ execPath: devContext.execPath, isPackaged: false })).toEqual({});
    });
});

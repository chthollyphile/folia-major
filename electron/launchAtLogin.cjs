// electron/launchAtLogin.cjs
// 开机自启的平台判定与登录项参数构造，从 main.cjs 抽出以便单测覆盖。

// Electron 的 setLoginItemSettings 只在 macOS 与 Windows 上生效；
// Linux 需要用户自行创建 autostart 的 .desktop 文件。
const SUPPORTED_PLATFORMS = ['darwin', 'win32'];

function isLaunchAtLoginSupported(platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

/**
 * 构造 Windows 登录项的定位参数。
 * 未打包时 process.execPath 指向 Electron 本体，直接注册会让开机启动的是 Electron
 * 而不是 Folia，因此显式带上应用入口路径。
 *
 * 读写必须共用这一组参数：getLoginItemSettings 在 Windows 上按 path + args 比对注册项，
 * 写入时带了 path/args 而读取时不带，会匹配不到刚写入的记录并误报未开启。
 */
function buildLoginItemQuery({ execPath, isPackaged, appPath }) {
  if (isPackaged || !appPath) {
    return {};
  }

  return {
    path: execPath,
    args: [appPath],
  };
}

function buildLoginItemSettings({ enabled, execPath, isPackaged, appPath }) {
  return {
    openAtLogin: Boolean(enabled),
    openAsHidden: false,
    ...buildLoginItemQuery({ execPath, isPackaged, appPath }),
  };
}

module.exports = {
  isLaunchAtLoginSupported,
  buildLoginItemQuery,
  buildLoginItemSettings,
};

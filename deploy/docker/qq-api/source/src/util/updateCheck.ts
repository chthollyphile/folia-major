import { loggerState } from './logger';

export const UPDATE_CHECK_ENV = 'QQ_DISABLE_UPDATE_CHECK';

// 当前文件：决定启动时是否向 npm registry 查询最新版本。
// 打包进容器或桌面端时不该在启动路径上 spawn `npm`：容器里是一次没有意义的外连，
// Windows 打包应用还可能闪出控制台窗口。
export const shouldCheckLatestVersion = (): boolean => {
  if (loggerState.isTestEnv) {
    return false;
  }

  if (process.env[UPDATE_CHECK_ENV] === 'true') {
    return false;
  }

  return process.env.NODE_ENV !== 'production';
};

import { configManager } from './manager';

// 触发一次初始化加载
const appConfig = configManager.getConfig();

export const serverConfig = appConfig.server;
export const requestConfig = appConfig.request;
export const apiConfig = appConfig.api;
export const commonParams = appConfig.api.commonParams;
export const _guid = appConfig.api._guid;
export const options = appConfig.api.options;
export const optionsPrefix = appConfig.api.optionsPrefix;
export const userInfo = appConfig.user;

export { appConfig, configManager };

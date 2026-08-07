import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../util/logger';
import { defaultConfig } from './default';
import { AppConfig, AppConfigSchema } from './schema';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: AppConfig;
  private isLoaded: boolean = false;
  private version: number = 1;

  private constructor() {
    this.config = defaultConfig as AppConfig;
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * 加载并校验配置
   * 可通过环境变量或外部配置文件进行深度合并
   */
  public loadConfig(externalConfig: Partial<AppConfig> = {}): void {
    if (this.isLoaded) return; // 避免重复加载，实现按需加载和缓存机制

    try {
      const mergedConfig = {
        ...this.config,
        ...externalConfig,
      };

      // 通过 Zod 强制进行类型与结构校验
      this.config = AppConfigSchema.parse(mergedConfig);
      this.isLoaded = true;

      logger.info('[ConfigManager] Config loaded and validated successfully.');
    } catch (error) {
      logger.error('[ConfigManager] Configuration validation failed:', error);
      process.exit(1); // 配置加载失败时终止启动
    }
  }

  /**
   * 获取当前应用配置（返回冻结的对象以确保访问安全性，避免在运行时被意外修改）
   */
  public getConfig(): Readonly<AppConfig> {
    if (!this.isLoaded) {
      this.loadConfig(); // 懒加载
    }
    return Object.freeze(this.config);
  }

  /**
   * 获取脱敏后的安全配置（用于对外暴露或非安全日志输出）
   */
  public getSafeConfig(): Record<string, unknown> {
    const conf = this.getConfig();
    return this.maskSensitiveData(conf);
  }

  /**
   * 动态更新配置（并触发审计日志记录）
   */
  public updateConfig(newConfig: Partial<AppConfig>, source: string = 'unknown'): void {
    const previousConfig = { ...this.config };
    const mergedConfig = { ...this.config, ...newConfig };

    try {
      this.config = AppConfigSchema.parse(mergedConfig);
      this.version += 1;
      this.auditLog(source, previousConfig, this.config);
      this.triggerAlert(source);
    } catch (error) {
      logger.error('[ConfigManager] Failed to update config dynamically:', error);
      throw error;
    }
  }

  /**
   * 审计日志机制
   */
  private auditLog(source: string, oldVal: AppConfig, newVal: AppConfig): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      source,
      version: this.version,
      // 日志中同样需要对敏感信息进行脱敏处理
      oldConfig: this.maskSensitiveData(oldVal),
      newConfig: this.maskSensitiveData(newVal),
    };

    // 写入日志文件或输出到监控流
    const logDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(
      path.join(logDir, 'config-audit.log'),
      `${JSON.stringify(logEntry)}\n`,
      'utf8',
    );
    logger.info(
      `[ConfigManager] Config changed by ${source}. Audit log recorded. Version: ${this.version}`,
    );
  }

  /**
   * 脱敏辅助方法
   */
  private maskSensitiveData(conf: Readonly<AppConfig>): Record<string, unknown> {
    return {
      ...conf,
      user: {
        ...conf.user,
        cookie: conf.user.cookie ? '*** MASKED ***' : '',
        musicid: conf.user.musicid ? '*** MASKED ***' : undefined,
        str_musicid: conf.user.str_musicid ? '*** MASKED ***' : undefined,
        musickey: conf.user.musickey ? '*** MASKED ***' : undefined,
        cookieList: conf.user.cookieList?.length ? ['*** MASKED ***'] : [],
        cookieObject: conf.user.cookieObject ? { '***': 'MASKED' } : {},
      },
    };
  }

  /**
   * 配置变更告警埋点
   */
  private triggerAlert(source: string): void {
    // 这里可以集成 Sentry / Prometheus 等告警系统
    logger.warn(`[ALERT] Configuration has been modified at runtime by source: ${source}`);
  }
}

export const configManager = ConfigManager.getInstance();

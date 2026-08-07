type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

const resolveLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;

  if (envLevel && envLevel in levelWeight) {
    return envLevel;
  }

  return isTestEnv ? 'error' : 'info';
};

const activeLevel = resolveLogLevel();

const shouldLog = (level: LogLevel): boolean => levelWeight[level] >= levelWeight[activeLevel];

const write =
  (level: LogLevel, method: 'log' | 'warn' | 'error') =>
  (...args: unknown[]): void => {
    if (shouldLog(level)) {
      console[method](...args);
    }
  };

export const logger = {
  debug: write('debug', 'log'),
  info: write('info', 'log'),
  warn: write('warn', 'warn'),
  error: write('error', 'error'),
};

export const loggerState = {
  isTestEnv,
  level: activeLevel,
};

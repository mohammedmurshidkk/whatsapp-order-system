type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LOG_LEVELS: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const currentLevel = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'INFO'];

function formatError(err: unknown): object {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name };
  }
  return { message: String(err) };
}

function log(level: LogLevel, message: string, data?: any): void {
  if (LOG_LEVELS[level] > currentLevel) return;

  const entry = {
    t: new Date().toISOString(),
    l: level,
    m: message,
    ...data,
  };

  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    console.log(`[${entry.t}] [${level}]`, message, data || '');
  }
}

export const logger = {
  error: (message: string, data?: any) => log('ERROR', message, data),
  warn: (message: string, data?: any) => log('WARN', message, data),
  info: (message: string, data?: any) => log('INFO', message, data),
  debug: (message: string, data?: any) => log('DEBUG', message, data),
  formatError,
};

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

function getTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(level: LogLevel, message: string, data?: unknown): void {
  const timestamp = getTimestamp();
  const logMessage = `[${timestamp}] [${level}] ${message}`;

  if (data !== undefined) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }
}

export const logger = {
  error: (message: string, data?: unknown) => log('ERROR', message, data),
  warn: (message: string, data?: unknown) => log('WARN', message, data),
  info: (message: string, data?: unknown) => log('INFO', message, data),
  debug: (message: string, data?: unknown) => log('DEBUG', message, data),
};

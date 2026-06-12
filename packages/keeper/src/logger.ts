import pino from 'pino';
import type { LoggerOptions } from 'pino';

const options: LoggerOptions = { level: process.env['LOG_LEVEL'] ?? 'info' };

if (process.env['NODE_ENV'] === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  };
}

export const log = pino(options);
export type Logger = typeof log;

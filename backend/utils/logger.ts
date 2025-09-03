import { randomUUID } from 'node:crypto';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const CURRENT_LEVEL = LEVELS[envLevel] ?? LEVELS.info;

export function getCorrelationId(req: any): string {
  const h = (name: string) => req?.headers?.[name] || req?.headers?.[name.toLowerCase()];
  return (h('x-request-id') || h('x-correlation-id') || randomUUID()) as string;
}

export function log(level: LogLevel, correlationId: string, event: string, data?: Record<string, any>) {
  if ((LEVELS[level] ?? 999) < CURRENT_LEVEL) return;
  const entry: any = {
    ts: new Date().toISOString(),
    level,
    event,
    correlationId,
    ...(data || {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function timeStart() {
  const start = Date.now();
  return () => Date.now() - start;
}


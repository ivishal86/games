import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const { combine, timestamp, json } = winston.format;

// Helper to create individual loggers
function createLogger(serviceName: string, folderName: string): winston.Logger {
  return winston.createLogger({
    format: combine(timestamp(), json()),
    defaultMeta: { serviceName },
    transports: [
      new DailyRotateFile({
        dirname: `logs/${folderName}`,
        filename: `${serviceName}-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '7d',
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ level, message, timestamp }) => {
            const value=`[${timestamp}] ${level}: ${message}`;
            return value;
          })
        ),
      }),
    ],
  });
}

// Individual loggers
const errorLogger = createLogger('error-logger', 'errors');
const infoLogger = createLogger('info-logger', 'info');
const betLogger = createLogger('bet-logger', 'bets');
const betFailLogger = createLogger('betFail-logger', 'betFail');
const amqpLogger = createLogger('amqp-logger', 'amqp');
const databaseLogger = createLogger('database-logger', 'database');
const RedisLogger = createLogger('redis-logger', 'redis');
const CashoutLogger = createLogger('cashout-logger', 'cashout');
const CashoutFailLogger = createLogger('cashoutFail-logger', 'cashoutFail');
const socketLogger = createLogger('socket-logger', 'socket');
const rollbackLogger = createLogger('rollback-logger', 'rollback');
const thirdPartyLogger = createLogger('third-party-logger', 'thirdParty');
const failedThirdPartyLogger = createLogger('failed-third-party-logger', 'thirdPartyFail');
// Logger functions
export async function logError(message: string, context: Record<string, unknown> = {}): Promise<void> {
  errorLogger.error({ message, ...context });
}

export async function logSocket(message: string, context: Record<string, unknown> = {}): Promise<void> {
  socketLogger.info({ message, ...context });
}

export async function logInfo(message: string, context: Record<string, unknown> = {}): Promise<void> {
  infoLogger.info({ message, ...context });
}

export async function logBet(message: string, data: Record<string, unknown>={}): Promise<void> {
  betLogger.info({ message, ...data });
}

export async function logBetFail(message: string, userId: string, ip: string): Promise<void> {
  betFailLogger.info({ message, userId, ip });
}

export async function logAmqp(message: string, context: Record<string, unknown> = {}): Promise<void> {
  amqpLogger.info({ message, ...context });
}

export async function logDatabase(message: string, context: Record<string, unknown> = {}): Promise<void> {
  databaseLogger.info({ message, ...context });
}

export async function logRedis(message: string, context: Record<string, unknown> = {}): Promise<void> {
  RedisLogger.info({ message, ...context });
}

export async function logCashout(message: string, context: Record<string, unknown> = {}): Promise<void> {
  CashoutLogger.info({ message, ...context });
}

export async function logCashoutFail(message: string, context: Record<string, unknown> = {}): Promise<void> {
  CashoutFailLogger.info({ message, ...context });
}
export async function logRollback(message: string, context: Record<string, unknown> = {}): Promise<void> {
  rollbackLogger.info({ message, ...context });
}
export async function logFailedThirtParty(message: string, context: Record<string, unknown> = {}): Promise<void>  {
  failedThirdPartyLogger.error({ message, ...context });
}
export async function logThirtParty(message: string, context: Record<string, unknown> = {}): Promise<void>  {
  thirdPartyLogger.info({ message, ...context });
}
import dotenv from 'dotenv';
dotenv.config();

export function parseMultiplier(value: string | undefined): number[] {
  if (!value) return [];
  return value.split(',').map(Number);
}
const {
  DB_NAME,
  DB_USER,
  DB_PORT,
  DB_PASS,
  DB_HOST,
  DB_DIALECT,
  PORT,
  REDIS_URL,
  AUTH_TOKEN,
  AMQP_CONNECTION_STRING,
  AMQP_EXCHANGE_NAME,
  SERVICE_BASE_URL,
  SECRET_KEY,
  FRONTEND_URL,
  MIN_BET,
  MAX_BET,
  MIN_ARROWS,
  MAX_ARROWS,
  ROOMID,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_RETRY,
  REDIS_RETRY_INTERVAL,
  GAME_NAME,
  BACKEND_URL,
  DRAW,
  OTHER,
  OTHERWITHDRAW
} = process.env;
if (!DB_NAME || !DB_USER || !DB_HOST || !DB_DIALECT) {
  throw new Error('Missing required environment variables.');
}

const config = {
  bet: {
    MIN_BET: Number(MIN_BET),
    MAX_BET: Number(MAX_BET),
    MIN_ARROWS: Number(MIN_ARROWS),
    MAX_ARROWS: Number(MAX_ARROWS),
  },
  db: {
    name: DB_NAME,
    user: DB_USER,
    port: Number(DB_PORT),
    password: DB_PASS,
    host: DB_HOST,
    dialect: DB_DIALECT as 'mysql' | 'postgres' | 'sqlite' | 'mariadb' | 'mssql',
  },
  PORT,
  redisUrl: REDIS_URL!,
  AUTH_TOKEN: AUTH_TOKEN!,
  REDIS_HOST: REDIS_HOST || '127.0.0.1',
  REDIS_PORT: Number(REDIS_PORT),
  AMQP_CONNECTION_STRING,
  AMQP_EXCHANGE_NAME,
  SERVICE_BASE_URL,
  SECRET_KEY,
  FRONTEND_URL,
  GAME_NAME,
  BACKEND_URL,
  ROOMID,
  redis: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    retry: Number(REDIS_RETRY),
    interval: Number(REDIS_RETRY_INTERVAL),
  },
  multiplier: {
    DRAW,
    OTHER,
    OTHERWITHDRAW
  }
};

export default config;

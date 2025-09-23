import dotenv from 'dotenv';
dotenv.config();

const {
  DB_NAME,
  DB_USER,
  DB_PORT,
  DB_PASS,
  DB_HOST,
  DB_DIALECT,
  PORT,
  REDIS_URL,
  USER_DETAIL_URL,
  AUTH_TOKEN,
  AMQP_CONNECTION_STRING,
  AMQP_EXCHANGE_NAME,
  SERVICE_BASE_URL,
  SECRET_KEY,
  FRONTEND_URL,
  MIN_BET,
  MAX_BET,
  MULTIPLIER,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_RETRY,
  REDIS_RETRY_INTERVAL,
  GAME_NAME,
  BACKEND_URL
} = process.env;

if (!DB_NAME || !DB_USER || !DB_HOST || !DB_DIALECT || !USER_DETAIL_URL) {
  throw new Error('Missing required environment variables.');
}
console.log(REDIS_HOST,
  REDIS_PORT,
  REDIS_RETRY,
  REDIS_RETRY_INTERVAL)
const config = {
   multiplier:Number(MULTIPLIER),
  bet: {
    MIN_BET:Number(MIN_BET),
    MAX_BET:Number(MAX_BET),
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
  USER_DETAIL_URL: USER_DETAIL_URL!, // Non-null assertion
  AUTH_TOKEN: AUTH_TOKEN!,
  AMQP_CONNECTION_STRING,
  AMQP_EXCHANGE_NAME,
  SERVICE_BASE_URL,
  SECRET_KEY,
  FRONTEND_URL,
  BACKEND_URL,
  GAME_NAME,
  redis: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    retry: Number(REDIS_RETRY),
    interval: Number(REDIS_RETRY_INTERVAL),
  },
};

export default config;

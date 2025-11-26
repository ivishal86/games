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
  BACKEND_URL,
  ROLLBACK_RETRY_LIMIT,
  RETRY_MILISECONDS,
  MULTIPLIER_URL
} = process.env;

if (!DB_NAME || !DB_USER || !DB_HOST || !DB_DIALECT) {
  throw new Error('Missing required environment variables.');
}
console.log(REDIS_HOST,
  REDIS_PORT,
  REDIS_RETRY,
  REDIS_RETRY_INTERVAL)
const config = {
  multiplier: Number(MULTIPLIER),
  bet: {
    MIN_BET: Number(MIN_BET),
    MAX_BET: Number(MAX_BET),
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
  AMQP_CONNECTION_STRING,
  AMQP_EXCHANGE_NAME,
  SERVICE_BASE_URL,
  SECRET_KEY,
  FRONTEND_URL,
  BACKEND_URL,
  GAME_NAME,
  MULTIPLIER_URL,
  redis: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    retry: Number(REDIS_RETRY),
    interval: Number(REDIS_RETRY_INTERVAL),
  },
  ROLLBACK_RETRY_LIMIT: Number(ROLLBACK_RETRY_LIMIT),
  RETRY_MILISECONDS: Number(RETRY_MILISECONDS),
  // SLOT_MULTIPLIERS: {
  //   "5": 60,        // 5 same
  //   "4": 7,         // 4 same
  //   "3-2": 6,       // 3 same + 2 same
  //   "3": 4,    // only 3 same
  //   "2-2": 2,     //2 same + 2 same
  //   "2": 0.1,       // only 2 same
  //   "0": 0          // no match
  // },
  //80
  // SLOT_OUTCOMES: [
  //   [0, 1, 2, 3, 4, 5, 6, 7], // More repetition of 0 & 1
  //   [0, 1, 2, 3, 4, 5, 6, 7],
  //   [0, 1, 2, 3, 4, 5, 6, 7],
  //   [0, 1, 2, 3, 4, 5, 6, 7],
  //   [0, 1, 2, 3, 4, 5, 6, 7]
  // ],

  SLOT_OUTCOMES: [
    [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 5, 6, 7],
    [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 6, 7, 7],
    [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 7],
    [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 7],
    [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 7]
  ],
  LOSING_SLOTS: [
    [0, 1,],
    [2, 3],
    [4, 5,],
    [6, 7],
    [7, 0]
  ]
  //   SLOT_OUTCOMES : [
  //   // Reel 1 (counts: [12,7,1,4,8,14,10,4] for symbols 0..7)
  //   [0,1,2,3,4,5,6,7, 0,1,3,4,5,6,7, 0,1,3,4,5, 0,1,3,4,5,6,7, 0,1,3,4,5,6,7, 0,1,3,4,5,6,7, 0,1,3,4,5,6,7, 0,5,5,5,5,5,5,5],
  //   // Reel 2 (counts: [8,6,6,7,13,4,3,13])
  //   [0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 0,1,2,3,4,7,7,7,7,7,7,7, 4,4,4,4, 6,6,6],
  //   // Reel 3 (counts: [12,5,11,9,6,2,10,5])
  //   [0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 0,1,2,3,4,6,6, 0,1,2,3,4,7,7,7,7,7, 0,1,2,3,4, 0,1,2,3, 0,1,2,3, 0,1,2,3],
  //   // Reel 4 (counts: [5,5,8,11,4,14,2,11])
  //   [0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 2,2,2,2,2,2, 3,3,3,3,3,3,3,3,3,3,3, 5,5,5,5,5,5,5,5,5,5,5,5,5, 6,6, 7,7,7,7,7,7,7,7,7,7,7],
  //   // Reel 5 (counts: [12,8,6,5,9,5,7,8])
  //   [0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 0,1,2,3,4,6,6, 0,1,2,3,4,5,5,5,5,5, 0,1,2,3,4,7,7,7,7,7,7,7, 0,1,2,3,4, 0,1,2,3]
  // ]
};

export default config;

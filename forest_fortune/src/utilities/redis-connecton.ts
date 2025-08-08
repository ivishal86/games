import dotenv from "dotenv";
import config from "../config/config";
import { Redis } from "ioredis";
import { logError, logInfo } from "./logger";
dotenv.config();
const { host, port, retry, interval } = config.redis;
const redisConfig = {
  host: host || "127.0.0.1",
  port: port || 6379,
  password: process.env.REDIS_PASSWORD || undefined, // Optional, if Redis is password-protected
};

const maxRetries = retry;
const retryInterval = interval;

export let redisClient: Redis | null = null;

export const createRedisClient = ():Redis => {
  const client = new Redis(redisConfig);

  client.on("error", (err) => {
    console.error(`REDIS ERROR: ${err.message}`);
  });

  client.on("connect", () => {
    console.info("💾 REDIS CONNECTION ESTABLISHED");
  });

  client.on("close", () => {
    console.info("REDIS CONNECTION CLOSED");
  });

  return client;
};

export const initializeRedis = async (): Promise<Redis> => {
  if (redisClient) {
    return redisClient;
  }
 
  let retries = 0;
 
  while (retries < maxRetries) {
    try {
      redisClient = createRedisClient();
      await redisClient.set('test', 'test'); // Test connection
      await redisClient.del('test'); // Clean up
      logInfo('✅ REDIS CONNECTION SUCCESSFUL');
      return redisClient;
    } catch (err: any) {
      retries += 1;
      logError(
        `REDIS CONNECTION FAILED. Retry ${retries}/${maxRetries}. Error: ${err.message}`
      );
      if (retries >= maxRetries) {
        logError('Maximum retries reached. Could not connect to Redis.');
        throw new Error('Failed to connect to Redis after maximum retries');
      }
      await new Promise(res => setTimeout(res, retryInterval));
    }
  }
 
  throw new Error('Unexpected exit from initializeRedis'); // Should never reach here due to while loop
};
export const getRedisClient = (): Redis => {
  if (!redisClient) {
    throw new Error('Redis client not initialized, Call initializeRedis() first.');
  }
  return redisClient;
};
export const setRedisClient = (client: Redis): void => {
  redisClient = client;
};
 
export const setHashField = async (hash: string, field: Record<string, string>): Promise<void> => {
  if (!redisClient) await initializeRedis();
  try {
    await redisClient!.hset(hash, field); // Use non-null assertion after initialization
  } catch (error) {
    logError(
      `Error setting hash field ${hash}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error; // Re-throw to allow caller to handle
  }
};

export const deleteHashField = async (hash: string): Promise<void> => {
  if (!redisClient) await initializeRedis();
  try {
    await redisClient!.del(hash); // Use non-null assertion after initialization
  } catch (error) {
    logError(
      `Error deleting hash field ${hash}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error; // Re-throw to allow caller to handle
  }
}

export const getHashField = async (hash: string): Promise<Record<string, string> | null> => {
  if (!redisClient) await initializeRedis();
  try {
    const value = await redisClient!.hgetall(hash); // Use non-null assertion after initialization
    return value || null;
  } catch (error) {
    logError(
      `Error getting hash field ${hash}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error; // Re-throw to allow caller to handle
  }
};

export const getAllBetHash = async (key: string): Promise<string[]> => {
  if (!redisClient) await initializeRedis();
  try {
    let cursor = '0';
    const allKeys: string[] = [];
 
    do {
      const [nextCursor, keys] = await redisClient!.scan(cursor, 'MATCH', key); // Use non-null assertion after initialization
      allKeys.push(...keys);
      cursor = nextCursor;
    } while (cursor !== '0');
 
    return allKeys;
  } catch (error) {
    logError(
      `Error getting all bet hashes for ${key}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error; // Re-throw to allow caller to handle
  }
};

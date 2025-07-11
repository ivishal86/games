import dotenv from "dotenv";
import config from "../config/config";
import { Redis } from "ioredis";
dotenv.config();
const { host, port, retry, interval } = config.redis;
const redisConfig = {
  host: host || "127.0.0.1",
  port: port || 6379,
  password: process.env.REDIS_PASSWORD || undefined, // Optional, if Redis is password-protected
};

const maxRetries = retry;
const retryInterval = interval;

export let redisClient: any;

export const createRedisClient = () => {
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

export const initializeRedis = async (): Promise<void> => {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      redisClient = createRedisClient();
      await redisClient.set("test", "test"); // Test connection
      await redisClient.del("test"); // Clean up
      console.info("✅ REDIS CONNECTION SUCCESSFUL");
      return redisClient;
    } catch (err: any) {
      retries += 1;
      console.error(
        `REDIS CONNECTION FAILED. Retry ${retries}/${maxRetries}. Error: ${err.message}`
      );
      if (retries >= maxRetries) {
        console.error("Maximum retries reached. Could not connect to Redis.");
        process.exit(1); // Exit the application with failure
      }
      await new Promise((res) => setTimeout(res, retryInterval));
    }
  }
};

export const setHashField = async (hash: string, field: Record<string, string>): Promise<void> => {
  if (!redisClient) await initializeRedis();
  try {
    await redisClient.hset(hash, field);
  } catch (error) {
    console.error(error)
  }
};

export const deleteHashField = async (hash: string): Promise<void> => {
  if (!redisClient) await initializeRedis();
  try {
    await redisClient.del(hash);
  } catch (error) {
    console.error(error)
  }
};

export const getHashField = async (hash: string): Promise<Record<string, string> | null> => {
  if (!redisClient) await initializeRedis();
  try {
    const value = await redisClient.hgetall(hash);
    if (value) {
      return value;
    } else {
      return null;
    }
  } catch (error) {
    console.error(error)
    return null;
  }
};

export const getAllBetHash = async (key: string): Promise<string[]> => {
  if (!redisClient) await initializeRedis();
  try {
    let cursor = '0';
    const allKeys = [];

    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', key);
      allKeys.push(...keys);
      cursor = nextCursor;
    } while (cursor !== '0');

    return allKeys;
  } catch (error) {
    console.error(error)
    return [];
  }
}

import Redis from 'ioredis';
import type { RedisOptions, Redis as RedisClient } from 'ioredis';

import dotenv from 'dotenv';
dotenv.config();

import { config } from '../../configs/appConfig';
import { createLogger } from '../utilities/logger';

const logger = createLogger('Redis');

const { host = '127.0.0.1', port = 6379, retry, interval } = config.redis;

const redisConfig: RedisOptions = {
    host,
    port,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
};

const maxRetries: number = Number(retry);
const retryInterval: number = Number(interval);

let redisClient: RedisClient | null = null;

const createRedisClient = (): RedisClient => {
    const client = new Redis(redisConfig);

    client.on('error', (err: Error) => {
        logger.error(`REDIS ERROR: ${err.message}`);
    });

    client.on('connect', () => {
        logger.info('REDIS CONNECTION ESTABLISHED');
    });

    client.on('close', () => {
        logger.info('REDIS CONNECTION CLOSED');
    });

    return client;
};

export const initializeRedis = async (): Promise<RedisClient> => {
    let retries = 0;

    while (retries < maxRetries) {
        try {
            redisClient = createRedisClient();
            await redisClient.set('test', 'test');
            await redisClient.del('test');
            logger.info('REDIS CONNECTION SUCCESSFUL');
            return redisClient;
        } catch (err: any) {
            retries += 1;
            logger.error(`REDIS CONNECTION FAILED. Retry ${retries}/${maxRetries}. Error: ${err.message}`);
            if (retries >= maxRetries) {
                logger.error('Maximum retries reached. Could not connect to Redis.');
                process.exit(1);
            }
            await new Promise(res => setTimeout(res, retryInterval));
        }
    }

    // Should never reach here
    throw new Error('Unable to initialize Redis');
};

// Redis Operations

export const setCache = async (key: string, value: any, expiration: number = 3600 * 9): Promise<"OK" | undefined> => {
    if (!redisClient) redisClient = await initializeRedis();
    try {
        return await redisClient.set(key, JSON.stringify(value), 'EX', expiration);
    } catch (error: any) {
        logger.error('Failed to set cache:', error.message);
    }
};

export const getCache = async (key: string): Promise<any | null> => {
    if (!redisClient) redisClient = await initializeRedis();
    try {
        const value = await redisClient.get(key);
        if (value) {
            return JSON.parse(value);
        } else {
            logger.info(`Cache not found: ${key}`);
            return null;
        }
    } catch (error: any) {
        logger.error('Failed to get cache:', error.message);
        return null;
    }
};

export const deleteCache = async (key: string): Promise<void> => {
    if (!redisClient) redisClient = await initializeRedis();
    try {
        await redisClient.del(key);
    } catch (error: any) {
        logger.error('Failed to delete cache:', error.message);
    }
};

export const incrementCache = async (key: string, amount: number = 1): Promise<number | null> => {
    if (!redisClient) redisClient = await initializeRedis();
    try {
        return await redisClient.incrby(key, amount);
    } catch (error: any) {
        logger.error('Failed to increment cache:', error.message);
        return null;
    }
};

export const clearRedisCache = async (): Promise<void> => {
    if (!redisClient) redisClient = await initializeRedis();
    try {
        await redisClient.flushdb();
        await redisClient.flushall();
        logger.info('Redis cache cleared');
    } catch (error: any) {
        logger.error('Failed to clear Redis cache:', error.message);
    }
};
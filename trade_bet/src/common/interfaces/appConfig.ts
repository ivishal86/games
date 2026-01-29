export interface IDBConfig {
    host: string;
    user: string;
    password: string;
    database: string;
    port: number;
    waitForConnections: boolean;
    connectionLimit: number;
    queueLimit: number;
}

export interface IDBProps {
    retries: number;
    interval: number;
}

export interface IRedisConfig {
    host: string;
    port: number;
    retry: number;
    interval: number;
}

export interface IAppConfigData {
    minQty: number;
    minDepositAmount: number;
    dbConfig: IDBConfig;
    dbProps: IDBProps;
    dbReadConfig: IDBConfig;
    redis: IRedisConfig;
    marketRedis: IRedisConfig;
    commission: number;
};
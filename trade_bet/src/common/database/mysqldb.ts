import { createPool } from "mysql2/promise";
import { createLogger } from "../utilities/logger";
import { config } from "dotenv";
import { trades, settlements, transactions, wallets } from "./tables";

config({ path: ".env" })

const logger = createLogger("DB", "plain")

export const pool = createPool({
    port: Number(process.env.DB_PORT ?? "3306"),
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

export const dbConnect = async () => {
    try {
        let dbMaxRetries: number = Number(process.env.DB_MAX_RETRIES) || 5;
        let connection;
        for (let i = 0; i < dbMaxRetries; i++) {
            connection = await pool.getConnection()
            if (connection) {
                logger.info(`db connection successful in ${i || 0} tries.`);
                break;
            } else {
                logger.error(`db connection unsuccessful in ${i} tries`);
                await new Promise(resolve => setTimeout(resolve, 1000 * i));
            }
        }

        if (!connection) process.exit(1)

        await pool.execute(trades);
        await pool.execute(settlements);
        await pool.execute(wallets);
        await pool.execute(transactions);

        return;
    } catch (error: any) {
        console.log(error);
        logger.error(JSON.stringify(error));
        process.exit(1);
    }
};


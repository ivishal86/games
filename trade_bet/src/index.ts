import { config } from "dotenv";
import { httpServer } from "./server";
import { clearRedisCache, initializeRedis } from "./common/cache/redis";
import { connect } from "./common/queues/amqp";
import { dbConnect } from "./common/database/mysqldb";
import { initializeMarketRedis } from "./modules/markets/controllers/marketClient";
import { setCacheToNode, setNodeDatatoCache } from "./common/cache/trades";

config({ path: "*" });

const PORT = process.env.PORT;
(async () => {

    httpServer.listen(PORT, () => console.log("SERVER RUNNING ON PORT:", PORT));
    await Promise.allSettled([initializeRedis(), initializeMarketRedis(), connect(), dbConnect(), setCacheToNode()]);

    async function closeServerRequest(event: string, err: any) {
        await setNodeDatatoCache();
        console.error('SIGTERM signal received: Closing HTTP server', event);
        console.error("error occured", err.message, err.stack);
        httpServer.close(() => {
            console.log('HTTP server closed.');
            process.exit(0);
        });
    }

    process.on('SIGTERM', async (err: any) => {
        await closeServerRequest("SIGTERM", err);
    });

    process.on('SIGINT', async (err: any) => {
        await closeServerRequest("SIGINT", err);
    });

    process.on('exit', async (err: any) => {
        await closeServerRequest("exit", err);
    });

    process.on('uncaughtException', async (err: any) => {
        await closeServerRequest("uncaughtException", err);
    });

})();
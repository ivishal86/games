import { Point } from "@influxdata/influxdb-client";
const { INFLUX_MEASUREMENT } = process.env;
import Redis, { type RedisOptions, Redis as RedisClient } from "ioredis";
import { createLogger } from "../../../common/utilities/logger";
import { config } from "../../../configs/appConfig";
import { exitHandlerForMarkets, updateRunningOdds } from "../../trades/controllers/tradeHandler";
import { io } from "../../../sockets/connections/serverSocket";
import { writeApi } from "../../../common/database/influxdb";

const logger = createLogger("Market_Redis");
const { host, port, retry, interval } = config.marketRedis;

const redisConfig: RedisOptions = {
    host,
    port,
};

const maxRetries = Number(retry);
const retryInterval = Number(interval);
let redisClient: RedisClient | null = null;

const createRedisClient = (): RedisClient => {
    const client = new Redis(redisConfig);

    client.on("connect", () => logger.info("REDIS CONNECTED"));
    client.on("close", () => logger.warn("REDIS CONNECTION CLOSED"));
    client.on("error", (err) => logger.error(`REDIS ERROR: ${err.message}`));

    return client;
};

export const initializeMarketRedis = async (): Promise<RedisClient> => {
    let retriesCount = 0;

    while (retriesCount < maxRetries) {
        try {
            const client = createRedisClient();

            // Check connection
            await client.set("ping", "pong");
            await client.del("ping");

            redisClient = client;
            logger.info("MARKET REDIS CONNECTION SUCCESSFUL");

            return redisClient;
        } catch (err: any) {
            retriesCount++;
            logger.error(
                `MARKET REDIS CONNECTION FAILED (${retriesCount}/${maxRetries}) → ${err.message}`
            );

            if (retriesCount >= maxRetries) {
                logger.error("Maximum retries reached — exiting.");
                process.exit(1);
            }

            await new Promise((res) => setTimeout(res, retryInterval));
        }
    }

    throw new Error("Unable to initialize Redis client");
};

export const getMarketRedis = (): RedisClient => {
    if (!redisClient) {
        throw new Error(
            "Redis not initialized! Call initializeMarketRedis() first."
        );
    }
    return redisClient;
};

const redisMessageHandler = async (channel: string, message: string) => {
    try {
        const data = JSON.parse(message);
        await writeInplayMarketData(data);
    } catch (err) {
        console.error("Err parsing data is::::", err);
    }
};

export const subscribeToChannel = async (
    channel: string
) => {
    const client = getMarketRedis();

    await client.subscribe(channel);

    client.off("message", redisMessageHandler);
    client.on("message", redisMessageHandler);
};

export const unsubscribeFromChannel = async (channel: string) => {
    const client = getMarketRedis();

    await client.unsubscribe(channel);

    if ((client as any).listenerCount?.("message") > 0) {
        client.off("message", redisMessageHandler);
    }
};

/*
{"id":670866,"mid":"1.250907255","st":"OPEN","eventID":"34987920","runners":[{"sid":16606,"s":"ACTIVE","ex":{"b":[{"p":1.2,"s":"420785.00"},{"p":1.19,"s":"2056157.00"},{"p":1.18,"s":"422212.00"}],"l":[{"p":1.21,"s":"422426.00"},{"p":1.22,"s":"2311669.00"},{"p":1.23,"s":"3236277.00"}]}},{"sid":10301,"s":"ACTIVE","ex":{"b":[{"p":10.5,"s":"50840.00"},{"p":10,"s":"603.00"},{"p":9.8,"s":"93597.00"}],"l":[{"p":11,"s":"15487.00"},{"p":11.5,"s":"860.00"},{"p":12,"s":"40857.00"}]}},{"sid":60443,"s":"ACTIVE","ex":{"b":[{"p":12,"s":"66671.00"},{"p":11.5,"s":"31574.00"},{"p":11,"s":"48718.00"}],"l":[{"p":12.5,"s":"112526.00"},{"p":13,"s":"92663.00"},{"p":13.5,"s":"57767.00"}]}}],"stake_limit":30000,"min_stake_limit":100,"max_market_limit":50000,"odd_limit":"2000","msg":"","bet_delay":0,"inplay_stake_limit":30000,"runnerName":[{"RN":"Australia","SID":16606},{"RN":"England","SID":10301},{"RN":"The Draw","SID":60443}],"has_trade_bet":1,"multiplier_unit":0,"trade_bet_stake_limit":0,"market_stake_limit":0,"betFetchTime":1764929000,"betFetchTimeMS":1764929000595}
*/

export const writeInplayMarketData = async (data: any) => {
    const points: Point[] = [];

    for (const runners of data.runners) {
        if (!runners) continue;
        const exData = runners["ex"] || {};

        if (Object.keys(exData).length > 0) {
            for (let runner in exData) {
                if (runner == "b" || runner == 'l') {
                    const catData = exData[runner];
                    if (data.st == "CLOSED") {
                        let tagName = `${data.mid}:${runners.sid}:${runner == 'l' ? 0 : 1}`;
                        const point = new Point(INFLUX_MEASUREMENT);
                        point.tag("id", tagName).floatField("odds", 0.00).intField("status", 0).intField('fetch_time', data.betFetchTimeMS);
                        points.push(point);
                        io.to(tagName).emit('stats', { id: tagName, odds: 0.00, status: 0, _time: data.betFetchTimeMS, time_ms: data.betFetchTimeMS });
                    }
                    else if (catData && catData.length > 0) {
                        const runnerData = catData[0];
                        let tagName = `${data.mid}:${runners.sid}:${runner == 'l' ? 0 : 1}`;
                        let slug = `${data.mid}:${runners.sid}`;
                        const point = new Point(INFLUX_MEASUREMENT);
                        const status = data.st == 'OPEN' ? 1 : 2;
                        point.tag("id", tagName).floatField("odds", runnerData.p).intField("status", status).intField('fetch_time', data.betFetchTimeMS);
                        points.push(point);
                        if (status == 1) await updateRunningOdds(slug, {
                            id: tagName, odds: runnerData.p, status, _time: data.betFetchTimeMS, time_ms: data.betFetchTimeMS
                        }, data.eventID);
                        io.to(tagName).emit('stats', { id: tagName, odds: runnerData.p, status, _time: data.betFetchTimeMS, time_ms: data.betFetchTimeMS });
                    }
                }
            }
        }
    };

    if (data.st == 'CLOSED') {
        const marketSlugs = data.runnerName.map((e: any) => {
            return [`${data.mid}:${e.SID}`];
        }).flat();
        await exitHandlerForMarkets(marketSlugs, "match_end");
        await unsubscribeFromChannel(data.mid);
    };

    writeApi.writePoints(points);
    await writeApi.flush();
    return;
};
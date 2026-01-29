import { Socket } from "socket.io";
import type { ITrade, IUserTrade, IWalletInfo } from "../../common/interfaces";
import { getCache, setCache } from "../../common/cache/redis";
import { logEventAndEmitResponse } from "../../common/utilities/helperFunc";
import { getAggregatedExchangeData, getCurrentExchanges, getExchangesByTimeRange, getLastExchange } from "../../modules/trades/controllers/exchange";
import { deleteUserTradeObject, getUserTradeObject, setUserTradeObject } from "../../common/cache/trades";
import { getBestMarketMid, getLowestRunners } from "../../modules/markets/services/marketServices";
import { calculateAverageRate } from "../../common/utilities/average";
import { io } from "../connections/serverSocket";

export const joinRoom = async (socket: Socket, payload: string[], walletInfo?: IWalletInfo) => {

    try {
        const walletInfoPassed = !!walletInfo;
        const walletKey = `WL:${socket.id}`;
        if (!walletInfo) walletInfo = await getCache(walletKey);

        if (!walletInfo?.user_id)
            return await logEventAndEmitResponse(socket.id, "jn", payload, "user cache not found");

        if (payload.length < 1)
            return await logEventAndEmitResponse(socket.id, "jn", payload, "invalid payload");

        let mid: string | null = null;
        let evId: string | null = null;
        let evIdToJoin: string | null = null;

        if (walletInfoPassed && payload.length == 1) {
            mid = payload[0];
        } else {
            evId = payload[0] || null;
            mid = payload[1] || null;
        }

        let sid = payload[2] || null;
        let cat = payload[3] || "1";       // default BACK
        let interval = payload[4] || "1m"; // default interval

        if (payload.length === 1 && evId) {
            const allMatches = [...await getCache("currentMatches"), ...await getCache("upcomingMatches")].flat();
            const currentMatch = allMatches.find((m: any) => m.evId.toString() === evId.toString());

            if (!currentMatch)
                return await logEventAndEmitResponse(socket.id, "jn", payload, "event not found");

            mid = getBestMarketMid(currentMatch)?.toString() || null;
            if (!mid) return await logEventAndEmitResponse(socket.id, "jn", payload, "no valid market found");
        }

        const marketCache: any = await getCache(mid!);
        if (!marketCache) return await logEventAndEmitResponse(socket.id, "jn", payload, "invalid market id");
        evIdToJoin = marketCache.eventId?.toString() || null;

        // Case 1 & 2 → sid auto-pick lowest runner
        if (payload.length <= 2) {
            sid = getLowestRunners(marketCache)?.toString() || null;
            if (!sid) return await logEventAndEmitResponse(socket.id, "jn", payload, "no valid runner found");
        }

        // Case 3 → if only sid provided, cat should be default "1" (back)
        if (payload.length === 3) cat = "1";

        // Case 3 & 4 → Validate SID
        const runnerExists = marketCache.runnerName.some((e: any) => e.SID == sid);
        if (!runnerExists) return await logEventAndEmitResponse(socket.id, "jn", payload, "invalid runner id");

        const slug = `${mid}:${sid}:${cat}`;
        const currentRooms = [...socket.rooms].filter(r => r !== socket.id);

        // cannot join more than 2 rooms (back+lay)
        if (currentRooms.length >= 2)
            return await logEventAndEmitResponse(socket.id, "jn", payload, "cannot join multiple rooms");

        if (socket.rooms.has(slug))
            return await logEventAndEmitResponse(socket.id, "jn", payload, "room already joined");

        // first room cannot be lay
        if (currentRooms.length === 0 && cat === "0")
            return await logEventAndEmitResponse(socket.id, "jn", payload, "cannot join lay room first");

        // second room rules
        if (currentRooms.length === 1) {
            const [eMid, eSid, eCat] = currentRooms[0].split(":");
            if (eMid != mid) socket.leave(currentRooms[0]);
            if (eSid != sid) socket.leave(currentRooms[0]);
        }

        // Fetch HISTORY
        const history = cat === "1" ? await getAggregatedExchangeData(slug, "8h", interval) : await getLastExchange(slug, "8h");
        socket.emit("statsHistory", Object.values(history));

        //Join Slug
        socket.join(slug);
        socket.emit("message", { event: "join_room", msg: "Room joined successfully", slug, evId: evIdToJoin });

        //Emitting Open Trades
        const tradeKey = `${walletInfo.user_id}:${walletInfo.operator_id}`;
        if (evIdToJoin && mid) await emitOpenTrade(evIdToJoin, tradeKey, mid, socket.id);
        return;
    } catch (err) {
        console.error("Join Room Error:", err);
    }
};

export const leaveRoom = async (socket: Socket, payload: string[]) => {
    try {
        if (payload.length != 3)
            return await logEventAndEmitResponse(socket.id, "lr", payload, "missing necassary paramters");
        const [mid, sid, cat] = payload;

        if (!["0", "1"].includes(cat))
            return await logEventAndEmitResponse(socket.id, "lr", payload, "invalid category paramter");

        const backSlug = `${mid}:${sid}:1`;
        const laySlug = `${mid}:${sid}:0`;

        // if cat back then leave room back and lay
        // if cat lay then leave room for lay only 
        const slugs = cat === "1" ? [backSlug, laySlug] : [laySlug];

        if (!slugs.some(s => socket.rooms.has(s)))
            return await logEventAndEmitResponse(socket.id, "lr", payload, "invalid room leave request");

        slugs.forEach(room => {
            if (socket.rooms.has(room)) socket.leave(room);

        });

        const walletKey = `WL:${socket.id}`;

        const wallet: IWalletInfo = await getCache(walletKey);
        if (!wallet)
            return console.error("User Cache Not Found for disconnected socket:", socket.id);

        socket.emit("message", { msg: "room left successfully", slugs, event: "leave_room" });
        return;
    } catch (error: any) {
        console.error("error occured", error);
    }
};

export const historyData = async (socket: Socket, payload: string) => {
    try {
        let [mid, sid, cat, date, min, sec, ...endTime] = payload.split(":");
        const timeOrStart =
            date && min && sec ? `${date}:${min}:${sec}` : date || min || sec;
        const endTimeStr = endTime.length ? endTime.join(":") : undefined;

        const slug = `${mid}:${sid}:${cat}`;

        if (!socket.rooms.has(slug)) {
            return await logEventAndEmitResponse(socket.id, "hs", { payload }, "room not joined");
        }
        let previousStats;

        if (endTimeStr) {
            previousStats = await getExchangesByTimeRange(slug, timeOrStart, endTimeStr);
        } else {
            previousStats = await getCurrentExchanges(slug, "1h");
        }
        socket.emit("statsHistory", Object.values(previousStats));

        return;
    } catch (error: any) {
        console.error("error occured:", error);
    }
};

//For Place Trade, Join Room and Exit Handlers
export async function emitOpenTrade(evId: string, tradeKey: string, curMid: string, socketId: string) {
    const userData = {
        evId: Number(evId),
        evNm: "",
        evnTrdCnt: 0,
        eventProfit: 0,
        markets: {} as Record<string, any>
    };

    const tradesBySlug = getUserTradeObject(tradeKey);

    if (!tradesBySlug) {
        io.to(socketId).emit("open_trades", userData);
        return;
    };

    const marketIds = new Set<string>();
    for (const slug of Object.keys(tradesBySlug)) {
        const trades = tradesBySlug[slug];
        if (!Array.isArray(trades) || trades.length === 0) continue;
        const [mid] = slug.split(":");
        marketIds.add(mid);
    };

    const marketCache = new Map<string, any>();
    await Promise.all([...marketIds].map(async mid => {
        const market = await getCache(mid);
        if (market) marketCache.set(mid, market);
    }));

    const runners: any[] = [];

    for (const [slug, trades] of Object.entries(tradesBySlug)) {
        if (!Array.isArray(trades) || trades.length === 0) continue;

        const [mid, sid] = slug.split(":");
        const market = marketCache.get(mid);
        if (!market || market.eventId != evId) continue;
        if (userData.evNm == '') userData.evNm = market.eventName;
        const runnerProfit = trades.reduce((sum: number, t: ITrade) => sum + t.profit, 0);

        userData.evnTrdCnt += trades.length;
        userData.eventProfit += runnerProfit;

        if (mid == curMid) {
            if (!runners.length) runners.push(...market.runnerName);
        }

        const marketBucket = userData.markets[mid] ?? (userData.markets[mid] = {
            marketName: market.marketName,
            ttlMktTrdes: 0
        });

        marketBucket.ttlMktTrdes += trades.length;

        if (!marketBucket[sid]) {
            const runner = market.runnerName.find((r: any) => r.SID == sid);
            marketBucket[sid] = {
                slug,
                runnerName: runner?.RN ?? "",
                runnerProfit,
                trades
            };
        };
    };

    const currentMarketUserAverage = runners.map(runner => {
        const slug = `${curMid}:${runner.SID}`;
        const trades = tradesBySlug[slug];
        if (!Array.isArray(trades) || trades.length === 0) return null;

        return {
            ...calculateAverageRate(trades),
            slug,
            runnerName: runner.RN ?? ""
        };
    }).filter(Boolean);

    if (currentMarketUserAverage.length) {
        io.to(socketId).emit("avgRate", currentMarketUserAverage);
    }

    io.to(socketId).emit("open_trades", userData);
};

//Event for universal events user trade
export async function userTrades(socket: Socket) {
    try {
        const walletKey = await getCache(`WL:${socket.id}`);
        if (!walletKey) {
            await logEventAndEmitResponse(socket.id, "trade", { sid: socket.id }, "Player details not found");
            return;
        }

        const tradeKey = `${walletKey.user_id}:${walletKey.operator_id}`;
        const tradesObj = getUserTradeObject(tradeKey);

        const userData: any = { ttlTrds: 0 };

        for (const tradeSlug in tradesObj) {
            const trades = tradesObj[tradeSlug];
            if (!Array.isArray(trades)) continue;

            const [mid, sid] = tradeSlug.split(":");
            const marketCache = await getCache(mid);
            if (!marketCache) continue;

            const eventId = marketCache.eventId;

            const runner = marketCache.runnerName?.find((r: any) => r.SID === Number(sid));
            const runnerName = runner?.RN || "";

            const tradeCount = trades.length;
            const profit = trades.reduce((a: number, t: ITrade) => a + t.profit, 0);

            userData.ttlTrds += tradeCount;

            if (!userData[eventId]) {
                userData[eventId] = {
                    evNm: marketCache.eventName,
                    evnTrdCnt: 0,
                    evnPft: 0,
                    markets: {}
                };
            }

            const eventData = userData[eventId];

            eventData.evnTrdCnt += tradeCount;
            eventData.evnPft += profit;

            if (!eventData.markets[mid]) {
                eventData.markets[mid] = {
                    marketName: marketCache.marketName,
                    ttlMktTrdes: 0,
                    sids: {}
                };
            }

            const marketData = eventData.markets[mid];
            marketData.ttlMktTrdes += tradeCount;

            marketData.sids[sid] = {
                slug: tradeSlug,
                runnerName,
                runnerProfit: profit,
                trades
            };
        };

        socket.emit("event_open_trades", userData);
        return;
    } catch (err: any) {
        console.error("Error while getting user open trades:", err);
        logEventAndEmitResponse(socket.id, "ot", {}, err?.message || "Something went wrong");
    }
};

export async function reconnect(pData: IWalletInfo, socket: Socket) {
    try {
        const tradeKey = `${pData.user_id}:${pData.operator_id}`;
        const userTrade = getUserTradeObject(tradeKey)
        if (userTrade) {
            pData.isLocked = true;
            userTrade.sId = socket.id;
            setUserTradeObject(tradeKey, userTrade)
        }
        await setCache(`WL:${socket.id}`, pData);
    } catch (error: any) {
        console.error("error occured:", error);
        return;
    }
};

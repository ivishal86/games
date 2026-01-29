import type { IGlobalSlug, IGlobalTrades, ITrade, IUserTrade } from "../interfaces";
import { logEventAndEmitResponse } from "../utilities/helperFunc";
import { deleteCache, getCache, setCache } from "./redis";

export let TRADES_OBJECT: IGlobalTrades = {};
export let SLUG_OBJECT: IGlobalSlug = {};

export const getTradeObject = (): IGlobalTrades => TRADES_OBJECT;
export const getUserTradeObject = (tradeKey: string): IUserTrade | undefined => TRADES_OBJECT[tradeKey];
export const setUserTradeObject = (tradeKey: string, userTrade: IUserTrade) => { TRADES_OBJECT[tradeKey] = userTrade };
export const updateTradeInTradesArr = (trade: ITrade, tradeKey: string, slug: string) => {
    const tradesArr = TRADES_OBJECT[tradeKey]?.[slug] as ITrade[] | undefined;
    if (!tradesArr) return;

    for (let i = 0; i < tradesArr.length; i++) {
        const t = tradesArr[i];
        if (t.trdTm === trade.trdTm && t.cat === trade.cat) {
            tradesArr[i] = trade;
            return;
        }
    }
};
export const deleteUserTradeObject = (tradeKey: string) => delete TRADES_OBJECT[tradeKey];
export const deleteTradesFromUserTradeObject = (tradeKey: string, slug: string) => {
    if (!TRADES_OBJECT[tradeKey]) return;
    if (!TRADES_OBJECT[tradeKey][slug]) return;

    delete TRADES_OBJECT[tradeKey][slug];
    return;
};

export const getSlugObject = (): IGlobalSlug => SLUG_OBJECT;
export const getTradeKeysOfSlugObject = (slug: string): string[] | undefined => SLUG_OBJECT[slug];

export const addTradeKeyToSlug = async (slug: string, tradeKey: string) => {
    if (!SLUG_OBJECT[slug]) SLUG_OBJECT[slug] = [];
    if (!SLUG_OBJECT[slug].includes(tradeKey)) SLUG_OBJECT[slug].push(tradeKey);
};

export const deleteUserFromSlugSet = (slug: string, tradeKey: string) => {
    if (!SLUG_OBJECT[slug]) return;
    else {
        SLUG_OBJECT[slug] = SLUG_OBJECT[slug].filter((key) => key != tradeKey);
        if (SLUG_OBJECT[slug].length == 0) delete SLUG_OBJECT[slug];
    }
};

export async function setNodeDatatoCache() {
    try {
        await setCache('trades', TRADES_OBJECT);
        await setCache('marketSlug', SLUG_OBJECT);
        await logEventAndEmitResponse("", "system", { TRADES_OBJECT, SLUG_OBJECT }, "Node data set to cache successfully");
        return;
    } catch (err) {
        console.error("error occured during setting node data to cache:", err);
        await logEventAndEmitResponse("", "system_error", { TRADES_OBJECT, SLUG_OBJECT }, "Error occured during setting node data to cache");
        return;
    }
};

export async function setCacheToNode() {
    try {
        TRADES_OBJECT = await getCache('trades') || {};
        SLUG_OBJECT = await getCache('marketSlug') || {};
        await Promise.all([deleteCache('trades'), deleteCache('marketSlug')]);
        await logEventAndEmitResponse("", "system", { TRADES_OBJECT, SLUG_OBJECT }, "Cache data set to Node memory successfully");
        return;
    } catch (err) {
        console.error("error occured during setting cache data to node memory:", err);
        await logEventAndEmitResponse("", "system_error", { TRADES_OBJECT, SLUG_OBJECT }, "Error occured during setting cache data to node memory");
        return;
    }
};
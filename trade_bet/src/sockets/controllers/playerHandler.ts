import { pool } from '../../common/database/mysqldb';
import { getCache } from '../../common/cache/redis';
import type { Info, IRawUserData } from '../../common/interfaces';
import type { Request, Response } from 'express';

function getImageValue(id: string): number {
    let sum = 0;
    for (const char of id) {
        sum += char.charCodeAt(0);
    }
    return sum % 10;
}

export const getUserDataFromSource = async (
    token: string,
    game_id: string
): Promise<Info | false | undefined> => {
    try {
        const baseUrl = process.env.service_base_url;
        if (!baseUrl) throw new Error("Service base URL is not defined");

        const url = `${baseUrl}/service/user/detail`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                token: token,
            },
        });

        const data = await response.json();

        const userData: IRawUserData | undefined = data?.user;
        if (userData) {
            userData["operator_id"] = data?.operator_id;

            const { operatorId, operator_id, user_id } = userData;
            const id = `${user_id}:${operatorId || operator_id}`;
            const image = getImageValue(id);

            const finalData: Info = {
                ...userData,
                id,
                game_id,
                token,
                image,
                operator_id: userData.operatorId
            };

            return finalData;
        }

        return;
    } catch (err: any) {
        console.error(err.message);
        return false;
    }
};

export async function statement(req: Request, res: Response) {
    try {
        const { sid, limit = 30 } = req.query;
        const walletInfo: Info = await getCache(`WL:${sid}`);

        if (!walletInfo || !sid) return res.status(400).send({ status: false, msg: "Invalid player details" });

        const { user_id, operator_id } = walletInfo;

        const tradeDataQuery = `SELECT event_name, event_start_date, market_name, trade_odds, co_odds, bonus,
            stake, win_amt, cat, status, created_at, reason
            FROM settlements
            WHERE user_id = ? AND operator_id = ?
            ORDER BY created_at DESC LIMIT ${limit}`;

        const [tradeStats]: any = await pool.query(tradeDataQuery, [user_id, operator_id]);

        if (!Array.isArray(tradeStats) || tradeStats.length === 0) {
            return res.status(200).send({ status: true, data: [] });
        }

        const eventsMap = new Map<string, any>();

        for (const trade of tradeStats) {
            const eventKey = trade.event_name;
            const marketKey = trade.market_name;

            if (!eventsMap.has(eventKey)) {
                eventsMap.set(eventKey, {
                    evNm: trade.event_name,
                    evDt: trade.event_start_date,
                    ttlWnAmt: 0,
                    mrkts: new Map<string, any>(),
                });
            }

            const eventObj = eventsMap.get(eventKey);
            eventObj.ttlWnAmt += trade.win_amt;

            if (!eventObj.mrkts.has(marketKey)) {
                eventObj.mrkts.set(marketKey, {
                    mkNm: trade.market_name,
                    ttlMrktWnAmt: 0,
                    trades: [],
                });
            }

            const marketObj = eventObj.mrkts.get(marketKey);
            marketObj.ttlMrktWnAmt += trade.win_amt;
            marketObj.trades.push({
                btTime: trade.created_at,
                stke: trade.stake,
                wnAmt: trade.win_amt,
                bonus: trade.bonus,
                chip: `${trade.cat} at ${trade.trade_odds}`,
                coOdds: trade.co_odds,
                reason: trade.reason
            });
        }

        const finalData = Array.from(eventsMap.values()).map(event => ({
            ...event,
            mrkts: Array.from(event.mrkts.values()),
        }));

        return res.status(200).send({ status: true, data: finalData });
    } catch (err) {
        console.error("Err: while trying to fetch statement for user:::", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};

export async function tradeHistory(req: Request, res: Response) {
    try {
        const { user_id, operator_id, limit = 10 } = req.query;
        const grouped = await fetchTradeHistory(user_id as string, operator_id as string, Number(limit));
        return res.status(200).send({ status: true, data: grouped });
    } catch (err) {
        console.error("Err: while trying to fetch trade history for user:::", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};

export const fetchTradeHistory = async (user_id: string, operator_id: string, limit = 10) => {
    try {
        const tradeDataQuery = `
      SELECT event_name, market_name, trade_odds, reason,
      stake, win_amt, cat, status, created_at
      FROM settlements
      WHERE user_id = ? AND operator_id = ?
      ORDER BY created_at DESC LIMIT ${limit}
    `;

        const [tradeStats]: any = await pool.query(tradeDataQuery, [user_id, operator_id]);
        const grouped: Record<string, any[]> = {};

        if (!Array.isArray(tradeStats) || tradeStats.length === 0) {
            return [];
        };

        tradeStats.forEach((trade: any) => {
            const dateKey = new Date(trade.created_at).toISOString(); // force ISO string

            const tradeObj = {
                evNm: trade.event_name,
                mkNm: trade.market_name,
                chip: `${trade.cat} at ${trade.trade_odds}`,
                stake: trade.stake,
                trdTm: trade.created_at,
                winAmt: trade.win_amt,
                status: trade.status,
                reason: trade.reason
            };

            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(tradeObj);
        });
        return grouped;

    } catch (error) {
        console.log(error);
    }

};

export async function fetchInGameStatements(req: Request, res: Response) {
    try {

        const { sid, limit = 30 } = req.query;
        const walletInfo: Info = await getCache(`WL:${sid}`);
        if (!walletInfo || !sid) return res.status(400).send({ status: false, msg: "Invalid player details" });
        const { user_id, operator_id } = walletInfo;
        const tradeDataQuery = `SELECT event_name, event_start_date, market_name, trade_odds, co_odds, runner_name, reason,
            stake, win_amt, balance, updated_balance, cat, status, created_at
            FROM settlements
            WHERE user_id = ? AND operator_id = ?
            ORDER BY created_at DESC LIMIT ${limit}`;

        const [tradeStats]: any = await pool.query(tradeDataQuery, [user_id, operator_id]);

        if (!Array.isArray(tradeStats) || tradeStats.length === 0) {
            return res.status(200).send({ status: true, data: [] });
        }

        const history: any[] = []

        for (const trade of tradeStats) {
            history.push({
                bonus: (trade.win_amt < trade.stake ? Math.abs(trade.win_amt + trade.stake) : 0),
                tradeTime: trade.created_at,
                stke: trade.stake,
                wnAmt: trade.win_amt,
                balance: trade.balance,
                updated_balance: trade.updated_balance,
                chip: trade.cat,
                trade_odds: Number(trade.trade_odds).toFixed(2),
                odds: Number(trade.co_odds).toFixed(2),
                status: trade.win_amt == 0 ? "N/A" : trade.win_amt > 0 ? "PROFIT" : "LOSS",
                reason: trade.reason,
                description: `EVENT: ${trade.event_name} >> Market: ${trade.market_name} >> Runner: ${trade.runner_name} >> ${`${trade.cat} at ${Number(trade.trade_odds).toFixed(2)}`}`,
            });
        };

        return res.status(200).send({ status: true, data: history });
    } catch (err) {
        console.error("Err: while trying to fetch statement for user:::", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};


export async function getEventList(req: Request, res: Response) {
    try {
        const liveMatches = await getCache("currentMatches")
        const upcomingMatches = await getCache("upcomingMatches")
        return res.status(200).send({ status: true, liveMatches, upcomingMatches });
    } catch (err) {
        console.error("Err: while trying to fetch trade history for user:::", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};
import { getCache, setCache } from "../../../common/cache/redis";
import type { IDbSettlementObject, IInfluxExchange, ITrade, IUserTrade, IWalletInfo, UpdateIntent } from "../../../common/interfaces";
import { logEventAndEmitResponse, requiredWalletInfo } from "../../../common/utilities/helperFunc";
import { Wallets } from "../../wallets/models/wallets";
import { getExchange } from "../controllers/exchange";
import { Settlements } from "../models/settlements";
import { io } from "../../../sockets/connections/serverSocket";
import { acquireLock, withLock } from "../../../common/utilities/locks";
import { deleteTradesFromUserTradeObject, deleteUserFromSlugSet, deleteUserTradeObject, getUserTradeObject, setUserTradeObject, updateTradeInTradesArr } from "../../../common/cache/trades";
import { emitOpenTrade } from "../../../sockets/controllers/socketHandler";
import { config } from "../../../configs/appConfig";
import type { Socket } from "socket.io";

export const emitProfit = async (wallet: IWalletInfo, trade: ITrade, sId: string) => {
    try {
        const profitKey = `OP:${wallet.user_id}:${wallet.operator_id}`;
        let overallProfit = await getCache(profitKey);
        if (overallProfit) {
            overallProfit = Number(overallProfit) + trade.profit;
            await setCache(profitKey, overallProfit);
        }
        io.to(sId).emit("overallProfit", overallProfit);
        return;
    } catch (error: any) {
        console.error("error occured:", error.message);
        return;
    }
}

export async function processSettlements(userTrade: IUserTrade): Promise<{ matchSlugs: string[], totalProfit: number, exitOdds: number }> {
    try {

        const settlementPromises: Promise<any>[] = [];
        const matchSlugs: string[] = [];
        let totalProfit = 0;
        let exitOdds = 0;
        for (const key in userTrade) {
            const value = userTrade[key];
            if (!Array.isArray(value)) continue;

            const tradesArr = value;
            matchSlugs.push(key);
            const [mid, sid] = key.split(':')

            let backEx = await getExchange(userTrade.sId, `${key}:1`, "8h", [mid, sid], "exit");
            let layEx = await getExchange(userTrade.sId, `${key}:0`, "8h", [mid, sid], "exit");

            const eventData = await getCache(mid);
            for (const t of tradesArr) {
                totalProfit += t.profit - t.bonus;
                if (t.updtBl <= 0) exitOdds = t.runningOdds;
                settlementPromises.push(
                    Settlements.create({
                        user_id: userTrade.user_id,
                        operator_id: userTrade.operator_id,
                        trade_time: t.trdTm,
                        slug: `${key}:${t.cat}`,
                        balance: t.initialBalance,
                        trade_odds: t.odds,
                        co_req_odds: Number(t.runningOdds),
                        co_odds: t.runningOdds,
                        stake: t.stake,
                        win_amt: Number(t.profit.toFixed(2)),
                        bonus: t.bonus,
                        updated_balance: Math.max(t.updtBl, 0),
                        updated_balance_at: t.updtBl <= 0 ? Date.now() : t.updtBlAt,
                        cat: t.cat === "1" ? "SELL" : "BUY",
                        status: "LOSS",
                        market_exchange: t.cat == "1" ? JSON.stringify(backEx) : JSON.stringify(layEx),
                        eventName: eventData.eventName,
                        marketName: eventData.marketName,
                        runnerName: (eventData.runnerName.find((e: any) => e.SID == sid))?.RN || "",
                        eventDate: eventData.eventDate,
                        reason: "negative_balance",
                        target_profit: t.targetProfit,
                        stop_loss: t.stopLoss,
                        max_cap: eventData.trade_bet_stake_limit
                    })
                );
            }
        }

        await Promise.allSettled(settlementPromises);
        return { matchSlugs, totalProfit, exitOdds };
    } catch (error: any) {
        console.error("error occured:", error.message);
        return { matchSlugs: [], totalProfit: 0, exitOdds: 0 };
    }
};

//For Update Running Odds open trades
export async function getOpenTrades(userTrade: IUserTrade, evId: string) {
    const userData = {
        evId: Number(evId),
        evNm: "",
        evnTrdCnt: 0,
        eventProfit: 0,
        markets: {} as Record<string, any>
    };

    const marketIds = new Set<string>();
    for (const key in userTrade) {
        const trades = userTrade[key];
        if (!Array.isArray(trades) || trades.length === 0) continue;

        const [mid] = key.split(":");
        marketIds.add(mid);
    }

    const marketCache = new Map<string, any>();
    await Promise.all([...marketIds].map(async mid => {
        const market = await getCache(mid);
        marketCache.set(mid, market);
    }));

    for (const [key, trades] of Object.entries(userTrade)) {
        if (!Array.isArray(trades) || trades.length === 0) continue;

        const [mid, sid] = key.split(":");
        const market = marketCache.get(mid);
        if (!market || market.eventId != evId) continue;
        if (userData.evNm == '') userData.evNm = market.eventName;
        const runnerProfit = trades.reduce((sum: number, t: ITrade) => sum + t.profit, 0);

        userData.evnTrdCnt += trades.length;
        userData.eventProfit += runnerProfit;

        const marketBucket = userData.markets[mid] ?? (userData.markets[mid] = {
            marketName: market.marketName ?? "",
            ttlMktTrdes: 0
        });

        marketBucket.ttlMktTrdes += trades.length;

        if (!marketBucket[sid]) {
            const runner = market.runnerName.find((r: any) => r.SID === Number(sid));

            marketBucket[sid] = {
                slug: key,
                runnerName: runner?.RN ?? "",
                runnerProfit,
                trades
            };
        }
    }

    return userData;
};

export const processExitHandler = async (socket: Socket, payload: string[]) => {

    if (!payload.length) {
        await logEventAndEmitResponse(socket.id, "exit", payload, "No Active Trade Found.");
        return;
    };

    const [mid, sid, cat, tradeTime, odds] = payload;

    if (!mid || !sid || !cat || !tradeTime || !odds) {
        await logEventAndEmitResponse("", "exit", payload, "Required Parameters Not Sent")
        return;
    }

    const walletKey = `WL:${socket.id}`;
    let wallet: IWalletInfo = await getCache(walletKey);

    if (!wallet) {
        await logEventAndEmitResponse(socket.id, "cashout", payload, "Wallet Not Found.");
        return;
    };

    const tradeKey = `${wallet.user_id}:${wallet.operator_id}`;
    const lock = await acquireLock(tradeKey);

    try {

        const tradeObj = getUserTradeObject(tradeKey);
        if (!tradeObj || !Object.keys(tradeObj).length) return;

        const event = await getCache(mid);

        const slug = `${mid}:${sid}`;
        const exchangeSlug = `${mid}:${sid}:${cat}`;

        const userTrade = getUserTradeObject(tradeKey);
        const sId = userTrade?.sId || "";
        const value = userTrade?.[slug];
        const tradesArr = Array.isArray(value) ? value : [];
        const tradeData = tradesArr.find(e => e.trdTm == Number(tradeTime) && e.cat == cat);

        if (!tradeData || !userTrade) return;

        const ex = await getExchange(sId, `${mid}:${sid}:${cat}`, "8h", payload, "exit") as IInfluxExchange | undefined;

        if (!ex) {
            await logEventAndEmitResponse(sId, "exit", payload, "No market data found for exit.");
            return;
        };

        const isTgtHit: boolean = tradeData.isTgtMet;
        if ((tradeData.cat == "0" && Number(odds) < ex.odds) && !isTgtHit) {
            await logEventAndEmitResponse(sId, "exit", payload, `Odds changed to ${ex.odds}.`);
            return;
        }

        if ((tradeData.cat == "1" && Number(odds) > ex.odds) && !isTgtHit) {
            await logEventAndEmitResponse(sId, "exit", payload, `Odds changed to ${ex.odds}.`);
            return;
        }

        userTrade.ttlStk -= tradeData.stake;
        const exitOdds = Math.min(ex.odds, event.trade_bet_stake_limit);
        const tgtPft: number = tradeData.targetProfit * (1 - (config.commission / 100));
        const isSell = cat === "1";
        let tradeProfit = Number((isSell ? tradeData.stake * ((tradeData.odds - exitOdds) * 100) : tradeData.stake * ((exitOdds - tradeData.odds) * 100)).toFixed(2));

        if (tradeProfit > 0) {
            tradeProfit = tradeProfit * (1 - (config.commission / 100))
            tradeProfit = Math.min(tradeProfit, tgtPft);
        };

        if (tradeProfit !== tradeData.profit) {
            tradeData.runningOdds = exitOdds;
            tradeData.updtBlAt = Date.now();
            tradeData.updtBl -= tradeData.profit;
            tradeData.updtBl += tradeProfit;
            userTrade.ttlBl -= tradeData.profit;
            userTrade.ttlBl += tradeProfit;
            userTrade.ttlProfit -= tradeData.profit
            userTrade.ttlProfit += tradeProfit;
            tradeData.profit = tradeProfit;
        };

        wallet.balance = userTrade.ttlBl;

        if (wallet.txn_id) {
            await Wallets.updateBalance(wallet.user_id, wallet.operator_id, wallet.balance, wallet.txn_id);
        };

        const isWin = tradeData.profit > 0;
        userTrade.ttlProfit = isWin ? userTrade.ttlProfit - tradeData.profit : userTrade.ttlProfit + tradeData.profit;

        const settlementObject: IDbSettlementObject = {
            user_id: userTrade.user_id,
            operator_id: userTrade.operator_id,
            slug: exchangeSlug,
            trade_time: tradeData.trdTm,
            balance: tradeData.initialBalance,
            trade_odds: tradeData.odds,
            co_req_odds: Number(odds),
            co_odds: exitOdds,
            stake: tradeData.stake,
            win_amt: tradeData.profit,
            bonus: tradeData.bonus,
            updated_balance: tradeData.updtBl,
            updated_balance_at: tradeData.updtBlAt,
            cat: tradeData.cat == "1" ? "SELL" : "BUY",
            status: isWin ? "WIN" : "LOSS",
            market_exchange: JSON.stringify(ex),
            eventName: event?.eventName || "",
            marketName: event?.marketName || "",
            runnerName: event?.runnerName?.find((e: any) => e.SID == sid)?.RN || "",
            eventDate: event?.eventDate || "",
            reason: isTgtHit ? "target_hit" : "manual_exit",
            target_profit: tradeData.targetProfit,
            stop_loss: tradeData.stopLoss,
            max_cap: event.trade_bet_stake_limit || 10
        };

        await Settlements.create(settlementObject);

        if (userTrade) {
            const newTrades = tradesArr.filter((e) => e.trdTm != Number(tradeTime));
            if (newTrades.length) {
                userTrade[slug] = newTrades;
                setUserTradeObject(tradeKey, userTrade);
            } else {
                deleteTradesFromUserTradeObject(tradeKey, slug);
                setUserTradeObject(tradeKey, userTrade);
                deleteUserFromSlugSet(slug, tradeKey);
            }
        }

        const isActiveTrade = Object.values(userTrade).some(el => typeof el === 'object');
        if (!isActiveTrade) {
            deleteUserTradeObject(tradeKey)
            wallet.isLocked = false;
        }


        await setCache(`WL:${sId}`, wallet);
        await emitProfit(wallet, tradeData, sId);

        setTimeout(async () => {
            io.to(sId).emit("stlmnt", {
                status: isWin ? "win" : "loss",
                exitOdds: exitOdds,
                winAmt: Number(tradeData.profit).toFixed(2),
                slug: exchangeSlug,
                trade: tradeData.trdTm
            });
            io.to(sId).emit("exit", {
                message: isTgtHit ? "Target profit amount hit" : "You have exited the trade successfully",
                reason: isTgtHit ? "target_hit" : "manual_exit",
                slug: exchangeSlug,
                trade: tradeData.trdTm
            });
            io.to(sId).emit("walletInfo", requiredWalletInfo(wallet));

            await emitOpenTrade(event.eventId, tradeKey, mid, sId);
        }, 1000);

        return;
    } catch (error: any) {
        console.error("Error in processExitHandler:", error);
        await logEventAndEmitResponse("", "exit", {}, error.message || "Something went wrong");
    } finally {
        lock()
    }
};

//Exit Handler for STOP LOSS
export const processAutoExitHandler = async (tradeKey: string, payload: string[], trade: ITrade, tradeBonus: number = 0) => {
    const lock = await acquireLock(tradeKey)
    try {
        const [mid, sid, cat, tradeTime] = payload;

        if (!mid || !sid || !cat || !tradeTime) {
            await logEventAndEmitResponse("", "exit", payload, "Required Parameters Not Sent")
            return;
        }

        const slug = `${mid}:${sid}`;
        const exchangeSlug = `${mid}:${sid}:${cat}`;

        const userTrade = getUserTradeObject(tradeKey);
        const sId = userTrade?.sId || "";

        if (!trade || !userTrade) return;


        const ex = await getExchange(sId, `${mid}:${sid}:${cat}`, "8h", payload, "exit") as IInfluxExchange | undefined;

        if (!ex) {
            await logEventAndEmitResponse(sId, "exit", payload, "No market data found for exit.");
            return;
        };

        const event = await getCache(mid);
        if (!event) {
            await logEventAndEmitResponse(sId, "exit", payload, "event details not found");
            return
        }

        const wallet: IWalletInfo = await getCache(`WL:${sId}`);
        if (!wallet) {
            await logEventAndEmitResponse(sId, "exit", payload, "wallet details not found");
            return
        }

        wallet.balance = userTrade.ttlBl;
        if (wallet.txn_id) {
            await Wallets.updateBalance(wallet.user_id, wallet.operator_id, wallet.balance, wallet.txn_id);
        };

        userTrade.ttlProfit = userTrade.ttlProfit + trade.profit;
        userTrade.ttlStk -= trade.stake;
        setUserTradeObject(tradeKey, userTrade);

        const settlementObject: IDbSettlementObject = {
            user_id: userTrade.user_id,
            operator_id: userTrade.operator_id,
            trade_time: trade.trdTm,
            slug: exchangeSlug,
            balance: trade.initialBalance,
            trade_odds: trade.odds,
            co_req_odds: Number(trade.runningOdds),
            co_odds: Number(trade.runningOdds),
            stake: trade.stake,
            win_amt: trade.profit,
            bonus: tradeBonus || trade.bonus,
            updated_balance: trade.updtBl,
            updated_balance_at: trade.updtBlAt,
            cat: cat == "1" ? "SELL" : "BUY",
            status: "LOSS",
            market_exchange: JSON.stringify({ ...ex, odds: trade.runningOdds }),
            eventName: event?.eventName || "",
            marketName: event?.marketName || "",
            runnerName: event?.runnerName?.find((e: any) => e.SID == sid)?.RN || "",
            eventDate: event?.eventDate || "",
            reason: "stop_loss_exceeded",
            target_profit: trade.targetProfit,
            stop_loss: trade.stopLoss,
            max_cap: event.trade_bet_stake_limit
        };

        await Settlements.create(settlementObject);

        if (userTrade) {
            const newTrades = userTrade?.[slug] || null;
            if (!newTrades) deleteUserFromSlugSet(slug, tradeKey);
        }

        const isActiveTrade = Object.values(userTrade).some(el => typeof el === 'object');
        if (!isActiveTrade) {
            deleteUserTradeObject(tradeKey)
            wallet.isLocked = false;
        }

        await setCache(`WL:${sId}`, wallet);
        await emitProfit(wallet, trade, sId);

        setTimeout(async () => {
            io.to(sId).emit("stlmnt", {
                status: "loss",
                exitOdds: Number(trade.runningOdds),
                winAmt: Number(trade.profit).toFixed(2),
                slug: exchangeSlug,
                trade: trade.trdTm
            });

            io.to(sId).emit("exit", {
                message: "Stop loss amount reached",
                reason: "stop_loss_exceeded",
                slug: exchangeSlug,
                trade: trade.trdTm
            });
            io.to(sId).emit("walletInfo", requiredWalletInfo(wallet));

            await emitOpenTrade(event.eventId, tradeKey, mid, sId);
        }, 1000);

        return;
    } catch (error: any) {
        console.error("Error in processAutoExitHandler:", error);
        await logEventAndEmitResponse("", "exit", {}, error.message || "Something went wrong");
    } finally {
        lock()
    }
};

export async function processUpdateRunningOdds(trade: ITrade, slug: string, tradeKey: string, ex: IInfluxExchange, eventId: string): Promise<UpdateIntent> {
    try {
        const { odds, stake, cat, trdTm } = trade;
        const runningOdds = ex.odds;
        const [mid, sid] = slug.split(':');

        const isSell = cat === "1";

        if (trade.runningOdds == runningOdds) return { type: 'NONE' };
        let tradeProfit = Number((isSell ? stake * ((odds - runningOdds) * 100) : stake * ((runningOdds - odds) * 100)).toFixed(2));
        if (tradeProfit > 0) tradeProfit = tradeProfit * (1 - (config.commission / 100));

        const userTrade = getUserTradeObject(tradeKey);
        if (!userTrade) return { type: 'NONE' };

        let tradeBonus = 0;
        const isStopLoss = tradeProfit <= trade.stopLoss;
        const isBalancePositive: Boolean = (userTrade.ttlBl + (tradeProfit - trade.profit)) > 0;

        if (isStopLoss && isBalancePositive) {
            if (tradeProfit < trade.stopLoss) {
                tradeBonus = tradeProfit - trade.stopLoss;
            }
            tradeProfit = trade.stopLoss;
        }

        const now = Date.now();
        const delta = Number((tradeProfit - trade.profit).toFixed(2));

        trade.isTgtMet = tradeProfit >= (trade.targetProfit * (1 - (config.commission / 100)));
        trade.profit = tradeProfit;
        trade.runningOdds = runningOdds;
        trade.updtBlAt = now;

        userTrade.ttlProfit += delta;
        userTrade.ttlBl += delta;
        const newBalance = Math.round(userTrade.ttlBl * 100) / 100;
        trade.updtBl = newBalance;

        if (newBalance < 0) trade.bonus = newBalance;
        updateTradeInTradesArr(trade, tradeKey, slug);
        setUserTradeObject(tradeKey, userTrade);

        if (newBalance <= 0) {
            deleteUserTradeObject(tradeKey);
            return { type: 'USER_LIQUIDATION', tradeKey, userTrade };
        }

        const openTrades = await getOpenTrades(userTrade, eventId);

        io.to(userTrade.sId).emit("oddsUpdt", {
            balance: newBalance,
            slug,
            openTrades,
            user_id: userTrade.user_id,
            operator_id: userTrade.operator_id
        });

        if (isStopLoss) {
            tradeExitHelper(tradeKey, [mid, sid, cat, trdTm.toString()]);
            return {
                type: 'TRADE_EXIT',
                data: {
                    tradeKey,
                    payload: [mid, sid, trade.cat, trade.trdTm.toString()],
                    trade,
                    tradeBonus,
                    sId: userTrade.sId
                }
            };
        }

        return { type: 'NONE' };
    } catch (err) {
        console.error("processUpdateRunningOdds error:", err);
        return { type: 'NONE' };
    }
};

export function tradeExitHelper(tradeKey: string, payload: string[]) {
    try {
        const [mid, sid, cat, tradeTime] = payload;
        const slug = `${mid}:${sid}`;
        const userTrade = getUserTradeObject(tradeKey);
        const value = userTrade?.[`${mid}:${sid}`];
        const tradesArr = Array.isArray(value) ? value : [];
        const newTrades = tradesArr.filter((e) => !(e.trdTm == Number(tradeTime) && e.cat == cat));
        if (userTrade) {
            if (newTrades.length) userTrade[slug] = newTrades;
            else delete userTrade[slug];
            setUserTradeObject(tradeKey, userTrade);
        }
        return
    } catch (error) {
        console.error("tradeExitHelper error:", error);
        throw error;
    }
}

export async function processUserLiquidation(tradeKey: string, userTrade: IUserTrade) {
    await withLock(tradeKey, async () => {

        if (!userTrade) return;
        const walletKey = `WL:${userTrade.sId}`;
        const wallet: IWalletInfo = await getCache(walletKey);
        if (!wallet) return;

        const { matchSlugs, totalProfit, exitOdds } = await processSettlements(userTrade);

        io.to(userTrade.sId).emit("stlmnt", {
            status: "loss",
            exitOdds,
            winAmt: userTrade.ttlProfit,  // last profit of the trade that liquidated the all trades
            slugs: matchSlugs
        });

        io.to(userTrade.sId).emit("exit", {
            message: "You are auto exited from trades due to negative balance",
            reason: "negative_balance"
        });

        for (const slug of matchSlugs) {
            deleteUserFromSlugSet(slug, tradeKey);
        }

        wallet.balance = 0;
        wallet.isLocked = false;

        if (wallet.txn_id) {
            await Wallets.updateBalance(wallet.user_id, wallet.operator_id, 0, wallet.txn_id);
        }

        await setCache(walletKey, wallet);
        await emitProfit(wallet, { profit: totalProfit } as ITrade, userTrade.sId);

        io.to(userTrade.sId).emit("walletInfo", requiredWalletInfo(wallet));
    });
};

// used for maket closure
export const customProcessExitHandler = async (tradeKey: string, payload: string[], event: any, rsn: string, wallet?: IWalletInfo) => {
    const lock = await acquireLock(tradeKey)
    try {
        const [mid, sid] = payload;

        if (!mid || !sid) {
            await logEventAndEmitResponse("", "exit", payload, "Required Parameters Not Sent")
            return;
        }

        const slug = `${mid}:${sid}`;

        const userTrade = getUserTradeObject(tradeKey);

        if (!userTrade) return;

        const value = userTrade?.[slug];

        const tradesArr = Array.isArray(value) ? value : [];
        const sId = userTrade.sId;

        if (!tradesArr.length || !userTrade) return;

        const walletKey = `WL:${sId}`;
        if (!wallet) wallet = await getCache(walletKey);
        if (!wallet) {
            await logEventAndEmitResponse(sId, "trade", payload, "Player details not found");
            return;
        }

        let totalProfit = 0;
        let tradesTime: number[] = [];

        const slugs: { [key: string]: IInfluxExchange } = {};

        await Promise.all(tradesArr.map(async (e: ITrade) => {
            const runnerSlug = `${slug}:${e.cat}`;
            if (!slugs.hasOwnProperty(runnerSlug)) {
                const history = await getExchange(sId, runnerSlug, "8h", payload, "exit") as IInfluxExchange | null;
                if (history) slugs[runnerSlug] = history;
            };
        }));

        for (const trade of tradesArr) {
            const exSlug = `${mid}:${sid}:${trade.cat}`;

            const exchange = slugs[exSlug] || null;
            if (!exchange) {
                await logEventAndEmitResponse(sId, "exit", payload, `exchange not found for exchangeSlug: ${exSlug}`);
                return
            };

            userTrade.ttlStk -= trade.stake;
            const exitOdds = Math.min(exchange.odds, event.trade_bet_stake_limit);
            const tgtPft: number = trade.targetProfit * (1 - (config.commission / 100));

            if (exitOdds !== trade.runningOdds) {
                const isSell = trade.cat === "1";

                let tradeProfit = Math.min(Number((isSell ? trade.stake * ((trade.odds - exitOdds) * 100) : trade.stake * ((exitOdds - trade.odds) * 100)).toFixed(2)), tgtPft);
                trade.runningOdds = exitOdds

                trade.updtBlAt = Date.now();
                trade.updtBl -= trade.profit;
                trade.updtBl += tradeProfit;

                userTrade.ttlBl -= trade.profit;
                userTrade.ttlBl += tradeProfit;

                userTrade.ttlProfit -= trade.profit
                userTrade.ttlProfit += tradeProfit;

                trade.profit = tradeProfit;
            };

            trade.profit = Math.min(trade.profit, tgtPft);
            const isWin = trade.profit > 0;
            userTrade.ttlProfit = isWin ? userTrade.ttlProfit - trade.profit : userTrade.ttlProfit + trade.profit;
            totalProfit += trade.profit;
            tradesTime.push(trade.trdTm);

            const settlementObject: IDbSettlementObject = {
                user_id: userTrade.user_id,
                operator_id: userTrade.operator_id,
                trade_time: trade.trdTm,
                slug: exSlug,
                balance: trade.initialBalance,
                trade_odds: trade.odds,
                co_req_odds: exitOdds,
                co_odds: exitOdds,
                stake: trade.stake,
                win_amt: trade.profit,
                bonus: trade.bonus,
                updated_balance: trade.updtBl,
                updated_balance_at: trade.updtBlAt,
                cat: trade.cat == "1" ? "SELL" : "BUY",
                status: isWin ? "WIN" : "LOSS",
                market_exchange: JSON.stringify(exchange),
                eventName: event.eventName || "",
                marketName: event.marketName || "",
                runnerName: event?.runnerName?.find((e: any) => e.SID == sid)?.RN || "",
                eventDate: event.eventDate || "",
                reason: rsn,
                target_profit: trade.targetProfit,
                stop_loss: trade.stopLoss,
                max_cap: event.trade_bet_stake_limit
            };

            await Settlements.create(settlementObject);
        };

        setUserTradeObject(tradeKey, userTrade);
        deleteTradesFromUserTradeObject(tradeKey, slug);
        deleteUserFromSlugSet(slug, tradeKey);

        const isActiveTrade: Boolean = Object.values(userTrade).some(el => typeof el == 'object');
        if (!isActiveTrade) {
            deleteUserTradeObject(tradeKey);
            wallet.isLocked = false;
        };


        wallet.balance = userTrade.ttlBl;
        if (wallet.txn_id) {
            await Wallets.updateBalance(wallet.user_id, wallet.operator_id, wallet.balance, wallet.txn_id);
        };

        await setCache(`WL:${sId}`, wallet);
        await emitProfit(wallet, { profit: totalProfit } as ITrade, sId);

        setTimeout(async () => {
            io.to(sId).emit("stlmnt", {
                status: totalProfit > 0 ? "win" : "loss",
                winAmt: Number(totalProfit).toFixed(2),
                slug,
                trade: tradesTime
            });
            io.to(sId).emit("exit", {
                message: rsn == "match_end" ? "You are auto exited from trades due to market closed" : "You have exited the trade successfully",
                reason: rsn,
                slug,
                trade: tradesTime
            });
            io.to(sId).emit("walletInfo", requiredWalletInfo(wallet!));

            await emitOpenTrade(event.eventId, tradeKey, mid, sId);
        }, 1000);

        return;
    } catch (error: any) {
        console.error("Error in processExitHandler:", error);
        await logEventAndEmitResponse("", "exit", {}, error.message || "Something went wrong");
    } finally {
        lock()
    }
};


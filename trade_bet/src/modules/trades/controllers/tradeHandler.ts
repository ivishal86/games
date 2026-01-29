import { Socket } from "socket.io";
import { getCache, setCache } from "../../../common/cache/redis";
import type { ITrade, IInfluxExchange, IWalletInfo, TradeExitIntent, IUserTrade } from "../../../common/interfaces";
import { customProcessExitHandler, processAutoExitHandler, processUpdateRunningOdds, processUserLiquidation } from "../services/tradeServices";
import { getUserIP } from "../../../common/utilities/commonFunction";
import { logEventAndEmitResponse, requiredWalletInfo, } from "../../../common/utilities/helperFunc";
import { createLogger } from "../../../common/utilities/logger";
import { Trades } from "../models/trades";
import { emitOpenTrade } from "../../../sockets/controllers/socketHandler";
import { getExchange } from "./exchange";
import { addTradeKeyToSlug, getTradeKeysOfSlugObject, getUserTradeObject, setUserTradeObject } from "../../../common/cache/trades";
import { acquireLock, withLock } from "../../../common/utilities/locks";
import { getStopLossTargetProfit } from "../../../common/utilities/profitLoss";
import { config } from "../../../configs/appConfig";

const matchClosedSlugsLogger = createLogger("match_closed_trigger", "plain");
const matchClosedLogger = createLogger("match_closed", "plain");

export const placeTrade = async (socket: Socket, payload: string[]) => {
    const walletKey = `WL:${socket.id}`;
    let wallet: IWalletInfo = await getCache(walletKey);

    if (!wallet) {
        await logEventAndEmitResponse(socket.id, "trade", payload, "Player details not found");
        return;
    };

    const tradeKey = `${wallet.user_id}:${wallet.operator_id}`;
    const lock = await acquireLock(tradeKey);

    try {
        const [mid, sid, cat, stk, od, acptAnyOds, trgtPft, stplos] = payload;
        const market = await getCache(mid);

        if (!market) {
            await logEventAndEmitResponse(socket.id, "trade", { payload, ...wallet }, "Invalid market id");
            return;
        }
        if (!socket.rooms.has(`${mid}:${sid}:${cat}`)) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "Join the room to place trade in the market");
            return
        }
        const {
            eventId,
            eventName,
            eventDate,
            runnerName,
            marketName,
            has_trade_bet,
            trade_bet_stake_limit,
            odds_multiplier
        } = market;

        if (!has_trade_bet) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "Trades are not allowed on this market");
            return;
        };

        let userTrade = getUserTradeObject(tradeKey)
        const balance = userTrade?.ttlBl || wallet.balance;
        const exchangeSlug = `${mid}:${sid}:${cat}`;
        const slug = `${mid}:${sid}`;
        const matchRunner = runnerName.find((e: any) => e.SID == sid)?.RN;

        let [
            category,
            stake,
            odds,
            acceptAnyOdds,
        ] = [cat, stk, od, acptAnyOds].map((e) => Number(e));

        if (isNaN(category) || ![0, 1].includes(category)) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "Invalid Trade Category");
            return;
        }
        if (isNaN(acceptAnyOdds) || ![0, 1].includes(acceptAnyOdds)) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "Invalid Trade Type");
            return;
        };

        let exchange = await getExchange(socket.id, exchangeSlug, "8h", payload, "place") as IInfluxExchange | undefined;

        if (!exchange) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "No market data found");
            return;
        }

        if (!exchange.odds) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "Trades have been closed for this odds");
            return;
        }

        if (exchange.odds <= 1.0 || exchange.odds >= trade_bet_stake_limit) {
            await logEventAndEmitResponse(socket.id, "trade", payload, `Odds not in acceptable range, multiplier unit is ${trade_bet_stake_limit}`);
            return;
        }

        if (exchange.status != 1) {
            await logEventAndEmitResponse(socket.id, "trade", payload, exchange.status == 0 ? "Market is closed" : "Market has been suspended");
            return;
        }

        if (!userTrade && balance < stake) {
            await logEventAndEmitResponse(socket.id, "trade", payload, "Insufficient Balance");
            return;
        }

        if (userTrade) {
            const totalStake = (userTrade.ttlStk || 0) + stake;
            const newBalance = balance - totalStake;
            if (newBalance < 0) {
                await logEventAndEmitResponse(socket.id, "trade", payload, "Insufficient Balance");
                return;
            };
        };

        if (stake < config.minQty) {
            await logEventAndEmitResponse(socket.id, "trade", payload, `Stake is less than minimum allowed quantity for the odds ${exchange.odds}`);
            return;
        }

        for (const odds of odds_multiplier) {
            if ((odds.min <= exchange.odds && exchange.odds <= odds.max) && odds.multiplier < stake) {
                await logEventAndEmitResponse(socket.id, "trade", payload, `Stake exceeds maximum allowed quantity for the odds ${exchange.odds}`);
                return;
            }
        };

        if (stplos && Number(stplos) < stake) {
            await logEventAndEmitResponse(socket.id, "trade", payload, `Stop loss is less than the stake for the odds ${exchange.odds}`);
            return;
        };

        // sell=1 & buy=0
        // back=1 & lay=0
        // If user does NOT accept any odds, validate change
        if (!acceptAnyOdds) {
            const isBackInvalid = cat === '1' && odds > exchange.odds;   // sell: odds cannot decrease
            const isLayInvalid = cat === '0' && odds < exchange.odds;   // buy: odds cannot increase

            if (isBackInvalid || isLayInvalid) {
                await logEventAndEmitResponse(socket.id, "trade", payload, `Odds changed to ${exchange.odds}`);
                return;
            }
        };

        odds = exchange.odds;
        const max = getStopLossTargetProfit(category, odds, stake, (balance - (userTrade?.ttlStk || 0)), trade_bet_stake_limit, trgtPft, stplos);

        const tradeData: ITrade = {
            stake,
            odds,
            cat,
            runningOdds: odds,
            profit: 0,
            initialBalance: balance,
            trdTm: Date.now(),
            bonus: 0,
            isTgtMet: false,
            targetProfit: max.targetProfit,
            stopLoss: -max.stopLoss,
            updtBl: balance,
            updtBlAt: Date.now(),
        };

        wallet.isLocked = true;
        await setCache(walletKey, wallet);
        socket.emit("walletInfo", requiredWalletInfo(wallet));

        if (!userTrade) {
            userTrade = {
                game_id: wallet.game_id,
                user_id: wallet.user_id,
                operator_id: wallet.operator_id,
                sId: socket.id,
                token: wallet.token,
                ttlStk: stake,
                isLiquidated: false,
                txnId: wallet.txn_id || "",
                ip: getUserIP(socket),
                ttlBl: balance,
                ttlProfit: 0,
            }
        } else userTrade.ttlStk += stake;


        if (userTrade[slug]) (userTrade[slug] as ITrade[]).push(tradeData)
        else userTrade[slug] = [tradeData];

        setUserTradeObject(tradeKey, userTrade);
        addTradeKeyToSlug(slug, tradeKey);

        await Trades.create({
            user_id: wallet.user_id,
            operator_id: wallet.operator_id,
            trade_time: tradeData.trdTm,
            slug: slug + ":" + cat,
            eventName,
            eventDate,
            runnerName: matchRunner,
            marketName,
            stake,
            trade_odds: odds,
            cat: cat == "1" ? "SELL" : "BUY",
            market_exchange: JSON.stringify(exchange),
            target_profit: max.targetProfit,
            stop_loss: -max.stopLoss,
            max_cap: trade_bet_stake_limit
        });

        socket.emit("trade", { message: `${cat == "1" ? "Sell" : "Buy"} ${stake} Odds at ${odds} multiplier`, ttlStk: userTrade.ttlStk });
        await emitOpenTrade(eventId, tradeKey, mid, socket.id);
        return;
    } catch (error: any) {
        console.error("error occured:", error);
        await logEventAndEmitResponse(socket.id, "trade", payload, error.message || "Something went Wrong");
    } finally {
        lock();
    }
};

// used to update the real time running odds
export async function updateRunningOdds(slug: string, ex: IInfluxExchange, eventId: string) {
    try {

        const tradeKeys = getTradeKeysOfSlugObject(slug);
        if (!tradeKeys?.length) return;

        const liquidationSet = new Map<string, IUserTrade>();
        const tradeExitQueue: TradeExitIntent[] = [];

        await Promise.all(
            tradeKeys.map(async tradeKey => {
                await withLock(tradeKey, async () => {
                    const userTradeObj = getUserTradeObject(tradeKey);
                    const value = userTradeObj?.[slug];
                    const tradesArr = Array.isArray(value) ? value : [];
                    if (!tradesArr.length) return;

                    const tradeCat = ex.id.split(':')[2];

                    for (const trade of tradesArr) {
                        if (trade.cat !== tradeCat) continue;

                        const intent = await processUpdateRunningOdds(trade, slug, tradeKey, ex, eventId);
                        if (intent.type === 'USER_LIQUIDATION') {
                            liquidationSet.set(intent.tradeKey, intent.userTrade);
                            return; // stop processing further trades
                        }

                        if (intent.type === 'TRADE_EXIT') {
                            tradeExitQueue.push(intent.data);
                        }
                    }
                });
            })
        );

        //  NORMAL TRADE EXITS
        for (const intent of tradeExitQueue) {
            await processAutoExitHandler(intent.tradeKey, intent.payload, intent.trade, intent.tradeBonus);
        }

        //  AUTO-LIQUIDATION (HIGHEST PRIORITY)
        for (const [tradeKey, userTrade] of liquidationSet.entries()) {
            await processUserLiquidation(tradeKey, userTrade);
        }
        return;
    } catch (err) {
        console.error('updateRunningOdds error:', err);
        return;
    }
};

/* CUSTOM EXIT HANDLERS */
export const exitHandlerForMarkets = async (matchSlugs: string[], rsn: string) => {
    matchClosedLogger.info(JSON.stringify({
        msg: "Triggered match ended for mid", matchSlugs
    }));
    try {
        const tasks = matchSlugs.map(async (slug: string) => {
            const mid = slug.split(":")[0];
            const event = await getCache(mid);

            if (!event) {
                await logEventAndEmitResponse("", "exit", { slug }, `event details not found for event: ${slug}`);
                return [];
            }

            const userTradeKeys = getTradeKeysOfSlugObject(slug);

            if (!userTradeKeys || userTradeKeys.length === 0) {
                matchClosedSlugsLogger.info(JSON.stringify({ msg: "No trades found", slug }));
                return [];
            }

            matchClosedSlugsLogger.info(JSON.stringify({ msg: "User trades found", slug, userIds: userTradeKeys }));

            const slugParts = slug.split(":");

            return userTradeKeys.map((tradeKey) => {
                return customProcessExitHandler(tradeKey, slugParts, event, rsn);
            });
        });

        await Promise.all(tasks);

        return;
    } catch (err: any) {
        console.error("Error in exitHandlerForMarkets:", err.message);
    }
};

//Mid:Sid1-Sid2-Sid3:Cat1-Cat2:tradeTime
// export const customExitHandler = async (socket: Socket, payload: string[]) => {
//     try {

//         if (!payload.length) {
//             await logEventAndEmitResponse(socket.id, "exit", payload, "No Active Trade Found.");
//             return;
//         };

//         const [mid, sid, cat, _] = payload;
//         const reason = "manual_exit";

//         const walletKey = `WL:${socket.id}`;
//         let wallet: IWalletInfo = await getCache(walletKey);

//         if (!wallet) {
//             await logEventAndEmitResponse(socket.id, "cashout", payload, "Wallet Not Found.");
//             return;
//         };

//         const tradeKey = `${wallet.user_id}:${wallet.operator_id}`;
//         const tradeObj = getUserTradeObject(tradeKey);

//         if (!tradeObj || !Object.keys(tradeObj).length) {
//             await logEventAndEmitResponse(socket.id, "exit", payload, "No Active Trade Found.");
//             return;
//         }

//         const event = await getCache(mid);
//         const sids = sid?.split("-") || [];

//         switch (payload.length) {
//             case 4: {
//                 await processExitHandler(tradeKey, payload, wallet, event);
//                 break;
//             }

//             case 3: {
//                 const tradesToExit: [string, string, string, string][] = [];

//                 for (const rId of sids) {
//                     const allTrades = tradeObj[`${mid}:${rId}`];
//                     if (!Array.isArray(allTrades)) continue;

//                     for (const trade of allTrades) {
//                         if (trade.cat === cat) {
//                             tradesToExit.push([mid, rId, trade.cat, trade.trdTm.toString()]);
//                         }
//                     }
//                 }

//                 if (tradesToExit.length) {
//                     await Promise.all(tradesToExit.map(slug => processExitHandler(tradeKey, slug, wallet, event)));
//                 };
//                 break;
//             };

//             case 2: {
//                 await Promise.all(sids.map(rId => customProcessExitHandler(tradeKey, [mid, rId], event, reason, wallet)));
//                 break;
//             };

//             case 1: {
//                 const tradesToExit: [string, string][] = [];

//                 for (const runner of event.runnerName || []) {
//                     const allTrades = tradeObj[`${mid}:${runner.SID}`];
//                     if (Array.isArray(allTrades) && allTrades.length) {
//                         tradesToExit.push([mid, runner.SID]);
//                     }
//                 }

//                 await Promise.all(tradesToExit.map(slug => customProcessExitHandler(tradeKey, slug, event, reason, wallet)));
//                 break;
//             };
//         };

//     } catch (error: any) {
//         console.error("error occured:", error.message);
//     }
// };
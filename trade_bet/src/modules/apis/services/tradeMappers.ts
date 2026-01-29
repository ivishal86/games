import type { DateWiseEvents, EventItem, EventReport, UserSummary } from "../../../common/interfaces";

export async function history(resp: any[]) {
    if (!Array.isArray(resp) || resp.length === 0) return [];

    const grouped: Record<string, any[]> = {};

    resp.forEach((t: any) => {
        const dateKey = new Date(t.created_at).toISOString().split("T")[0];

        if (!grouped[dateKey]) grouped[dateKey] = [];

        grouped[dateKey].push({
            evNm: t.event_name,
            mkNm: t.market_name,
            chip: `${t.cat} at ${t.trade_odds}`,
            stake: Number(t.stake),
            max_cap: t.max_cap,
            stop_loss: t.stop_loss,
            target_profit: t.target_profit,
            trdTm: t.trade_time,
            winAmt: t.win_amt,
            status: t.status,
            reason: t.reason,
            exit_time: t.created_at
        });
    });

    return Object.keys(grouped).map(date => ({
        date,
        records: grouped[date]
    }));
};

export async function adminInGameStatements(resp: any[]) {

    if (!Array.isArray(resp) || resp.length === 0) return [];

    return resp.map(trade => {
        const stake = Number(trade.stake) || 0;
        const winAmt = Number(trade.win_amt) || 0;

        return {
            bonus: winAmt < stake ? Math.abs(winAmt + stake) : 0,
            user_id: trade.user_id,
            eventName: trade.event_name,
            marketName: trade.market_name,
            runnerName: trade.runner_name,
            tradeTime: new Date(trade.trade_time),
            max_cap: trade.max_cap,
            stop_loss: trade.stop_loss,
            target_profit: trade.target_profit,

            stke: stake,
            wnAmt: winAmt,

            balance: trade.balance,
            updated_balance: trade.updated_balance,
            exit_time: trade.created_at,

            chip: trade.cat,
            trade_odds: Number(trade.trade_odds || 0).toFixed(2),
            exit_odds: Number(trade.co_odds || 0).toFixed(2),

            status:
                winAmt === 0
                    ? "N/A"
                    : winAmt > 0
                        ? "PROFIT"
                        : "LOSS",

            reason: trade.reason
        };
    });
};

export async function inGameStatements(resp: any[], limit: number) {
    if (!Array.isArray(resp) || resp.length === 0) return [];

    const finalData: any[] = [];
    let updatedBalance: number = resp[0]?.updated_balance || 0;
    let pushedTradeCount: number = 0;

    for (const trade of resp) {
        if (pushedTradeCount == limit) break;

        if (trade.type) {
            if (trade.type == 'DEBIT') updatedBalance = trade.updated_balance - trade.amount;
            if (trade.type == 'CREDIT') updatedBalance = trade.amount;
            finalData.push(trade);
            continue;
        };

        const baseObj: any = {
            user_id: trade.user_id,
            eventName: trade.event_name,
            marketName: trade.market_name,
            runnerName: trade.runner_name,
            stopLoss: trade.stop_loss,
            target: trade.target_profit,
            tradeTime: new Date(trade.trade_time),
            exit_time: trade.created_at,
            chip: trade.cat,
            trade_odds: Number(trade.trade_odds || 0).toFixed(2),
            exit_odds: Number(trade.co_odds || 0).toFixed(2),
            requested_odds: Number(trade.co_req_odds || 0).toFixed(2),
            reason: trade.reason,
        };

        const stake = trade.stake ?? 0;
        const winAmt = trade.win_amt ?? 0;
        const bonus = trade.bonus ?? 0;

        if (bonus < 0) {
            const bonusEntry = {
                ...baseObj,
                stake: 'N/A',
                winAmt: -bonus,
                status: 'BONUS',
                updated_balance: updatedBalance,
                balance: updatedBalance == 0 && trade.reason == 'negative_balance' ? bonus : updatedBalance + bonus,
            };

            updatedBalance = bonusEntry.balance;
            finalData.push(bonusEntry);

            const lossEntry = {
                ...baseObj,
                stake,
                winAmt: bonusEntry.updated_balance === 0 && trade.reason == 'negative_balance' ? winAmt : winAmt + bonus,
                status: 'LOSS',
                updated_balance: updatedBalance,
                balance: bonusEntry.updated_balance === 0 && trade.reason == 'negative_balance' ? updatedBalance - winAmt : updatedBalance - (winAmt + bonus),
            };

            updatedBalance = lossEntry.balance;
            finalData.push(lossEntry);
            pushedTradeCount++;
            continue;
        };

        const tradeEntry = {
            ...baseObj,
            stake,
            winAmt,
            status: winAmt === 0 ? 'N/A' : winAmt > 0 ? 'PROFIT' : 'LOSS',
            updated_balance: updatedBalance,
            balance: updatedBalance - winAmt,
        };

        updatedBalance = tradeEntry.balance;
        finalData.push(tradeEntry);
        pushedTradeCount++;
    };

    return finalData;
};

export async function eventStatement(resp: any[]) {
    if (!Array.isArray(resp) || resp.length === 0) return [];

    const eventsMap = new Map<string, any>();

    for (const trade of resp) {
        const evKey = trade.event_name;
        const mkKey = trade.market_name;

        if (!eventsMap.has(evKey)) {
            eventsMap.set(evKey, {
                evNm: evKey,
                evDt: trade.event_start_date,
                ttlWnAmt: 0,
                mrkts: new Map()
            });
        }

        const eventObj = eventsMap.get(evKey);
        eventObj.ttlWnAmt += Number(trade.win_amt);

        if (!eventObj.mrkts.has(mkKey)) {
            eventObj.mrkts.set(mkKey, {
                mkNm: mkKey,
                ttlMrktWnAmt: 0,
                trades: []
            });
        }

        const marketObj = eventObj.mrkts.get(mkKey);
        marketObj.ttlMrktWnAmt += Number(trade.win_amt);

        marketObj.trades.push({
            btTime: new Date(trade.trade_time),
            exTime: trade.created_at,
            runnerName: trade.runner_name || trade.runnerName,
            max_cap: trade.max_cap,
            stop_loss: trade.stop_loss,
            target_profit: trade.target_profit,
            stke: trade.stake,
            wnAmt: trade.win_amt,
            bonus: trade.bonus,
            chip: `${trade.cat} at ${trade.trade_odds}`,
            coOdds: trade.co_odds,
            coReqOdds: trade.co_req_odds,
            reason: trade.reason
        });
    }

    return Array.from(eventsMap.values()).map(ev => ({
        ...ev,
        mrkts: Array.from(ev.mrkts.values())
    }));
};

export async function profitLoss(resp: any[]) {

    if (!Array.isArray(resp) || resp.length === 0) {
        return { summary: [], details: [] };
    }

    const summaryMap = new Map();
    const detailMap = new Map();

    resp.forEach(trade => {

        const evKey = trade.event_name;
        const mkKey = trade.market_name;
        const rnNm = trade.runner_name || "";
        const pnl = trade.win_amt < 0 && trade.reason == 'negative_balance' ? trade.win_amt - trade.bonus : trade.win_amt;

        if (!summaryMap.has(evKey)) {
            summaryMap.set(evKey, {
                evNm: evKey,
                evDt: trade.event_start_date,
                ttlPnl: 0,
                markets: new Map()
            });
        }

        const sumEv = summaryMap.get(evKey);

        if (!sumEv.markets.has(mkKey)) {
            sumEv.markets.set(mkKey, {
                mkNm: mkKey,
                result: rnNm,
                ttlPnl: 0
            });
        }

        sumEv.markets.get(mkKey).ttlPnl += pnl;
        sumEv.ttlPnl += pnl;


        if (!detailMap.has(evKey)) {
            detailMap.set(evKey, {
                evNm: evKey,
                ttlPnl: 0,
                mrkts: new Map()
            });
        }

        const detEv = detailMap.get(evKey);
        detEv.ttlPnl += pnl;

        if (!detEv.mrkts.has(mkKey)) {
            detEv.mrkts.set(mkKey, {
                mkNm: mkKey,
                runners: new Map()
            });
        }

        const detMk = detEv.mrkts.get(mkKey);

        if (!detMk.runners.has(rnNm)) {
            detMk.runners.set(rnNm, {
                rnNm,
                ttlPnl: 0,
                trades: []
            });
        }

        const runner = detMk.runners.get(rnNm);
        runner.ttlPnl += pnl;

        runner.trades.push({
            chip: trade.cat,
            rate: trade.trade_odds,
            exitRate: trade.co_odds,
            unit: trade.stake,
            pnl,
            time: trade.created_at
        });
    });

    const summary = Array.from(summaryMap.values()).map(ev => ({
        evNm: ev.evNm,
        evDt: ev.evDt,
        ttlPnl: ev.ttlPnl,
        markets: Array.from(ev.markets.values())
    }));

    const details = Array.from(detailMap.values()).map(ev => ({
        evNm: ev.evNm,
        ttlPnl: ev.ttlPnl,
        mrkts: Array.from(ev.mrkts.values()).map((mk: any) => ({
            mkNm: mk.mkNm,
            runners: Array.from(mk.runners.values())
        }))
    }));

    return {
        data: { summary, details }
    };
};

export async function eventProfitLoss(resp: any[]) {

    if (!Array.isArray(resp) || resp.length === 0) {
        return {};
    }

    const eventMap = new Map<string, Map<string, { operator_id: string; netWin: number }>>();

    for (const trade of resp) {
        const effectiveWin = trade.win_amt < 0 && trade.reason == 'negative_balance' ? trade.win_amt - trade.bonus : trade.win_amt;

        if (!eventMap.has(trade.event_name)) {
            eventMap.set(trade.event_name, new Map());
        }

        const userMap = eventMap.get(trade.event_name)!;

        if (!userMap.has(trade.user_id)) {
            userMap.set(trade.user_id, {
                operator_id: trade.operator_id,
                netWin: 0,
            });
        }

        userMap.get(trade.user_id)!.netWin += effectiveWin;
    }

    const reports: EventReport[] = [];

    for (const [event_name, userMap] of eventMap.entries()) {
        let totalWin = 0;
        let winUsers = 0;
        let lossUsers = 0;
        let breakevenUsers = 0;

        const users: UserSummary[] = [];

        for (const [user_id, { operator_id, netWin }] of userMap.entries()) {
            totalWin += netWin;

            if (netWin > 0) winUsers++;
            else if (netWin < 0) lossUsers++;
            else breakevenUsers++;

            users.push({
                user_id,
                operator_id,
                win_amount: Number(netWin.toFixed(2)),
            });
        }

        reports.push({
            event_name,
            total_user_win_amount: Number(totalWin.toFixed(2)),
            total_users_traded: userMap.size,
            win_users: winUsers,
            loss_users: lossUsers,
            breakeven_users: breakevenUsers,
            users,
        });
    };

    return reports;
};

export function segregateEventsByDate(events: EventItem[]): DateWiseEvents {
    return events.reduce<DateWiseEvents>((acc, event) => {
        const dateKey = event.event_start_date.toISOString().split('T')[0];
        if (!acc[dateKey]) {
            acc[dateKey] = [];
        };
        acc[dateKey].push(event);
        return acc;
    }, {});
};
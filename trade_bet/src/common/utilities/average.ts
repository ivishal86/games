import type { ITrade } from "../interfaces";

export function calculateAverageRate(trades: ITrade[]) {
    trades = Array.isArray(trades) ? trades : [];
    if (!trades.length) return { avgRate: 0, status: "NEUTRAL" };

    let buyUnits = 0;
    let sellUnits = 0;
    let buyRates = 0;
    let sellRates = 0;

    for (const trade of trades) {
        if (trade.cat == "0") {
            buyUnits += trade.stake;
            buyRates += trade.runningOdds;
        } else if (trade.cat == "1") {
            sellUnits += trade.stake;
            sellRates += trade.runningOdds;
        }
    }
    const totalUnit = buyUnits - sellUnits;

    if (buyUnits === sellUnits) {
        return { avgRate: 0, status: "NEUTRAL", totalUnit };
    }
    const avgRate = (((buyRates - sellRates) / (buyUnits - sellUnits))).toFixed(2);
    return { avgRate, status: totalUnit > 0 ? "BUY" : "SELL", totalUnit };
};

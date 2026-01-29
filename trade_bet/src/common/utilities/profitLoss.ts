export const getStopLossTargetProfit = (cat: number, odds: number, stake: number, balance: number, maxCap: number, targetProfit?: string, stopLoss?: string) => {
    const base = (odds - 1) * stake * 100;

    let stopLossLimit = base;
    let targetProfitLimit = base;

    if (stopLoss && targetProfit) {
        stopLossLimit = Math.min(stopLossLimit, Number(stopLoss));
        targetProfitLimit = Math.min(targetProfitLimit, Number(targetProfit));
        if (stopLossLimit < targetProfitLimit) targetProfitLimit = stopLossLimit;
    };

    const maxDiff = (maxCap - odds) * 100 * stake;

    if (cat === 0 && targetProfitLimit > maxDiff) {
        targetProfitLimit = maxDiff;
        stopLossLimit = Math.min(stopLossLimit, maxDiff);
    };

    if (cat === 1 && stopLossLimit > maxDiff) {
        stopLossLimit = maxDiff;
        targetProfitLimit = Math.min(targetProfitLimit, maxDiff);
    };

    if (balance < stopLossLimit) {
        stopLossLimit = balance;
        if (targetProfitLimit > stopLossLimit) targetProfitLimit = stopLossLimit;
    }

    return {
        stopLoss: Number(stopLossLimit.toFixed(2)),
        targetProfit: Number(targetProfitLimit.toFixed(2))
    };
};

export function getLowestRunners(data: any): number | null {

    if (!data || !Array.isArray(data.runners)) return null;
    let lowestSid: number | null = null;
    let lowestPrice: number = Infinity;

    for (const runner of data.runners) {
        if (!runner || !runner.ex?.b) continue;
        if (runner.ex?.b.length > 0 && lowestPrice > runner?.ex?.b[0].p) {
            lowestPrice = runner?.ex?.b[0].p
            lowestSid = runner.sid;
        }
    };

    return lowestSid;
};

export function getBestMarketMid(currentMatch: any): number | null {
    if (!currentMatch?.mktNm || !Array.isArray(currentMatch.mktNm)) return null;

    // Try MATCH ODDS first
    const matchOdds = currentMatch.mktNm.find((mk: any) => mk.marketName?.toLowerCase() === "match odds" && mk.has_trade_bet);
    if (matchOdds?.mid) return matchOdds.mid;

    const lowest = currentMatch?.mktNm[0]?.mid || null;
    return lowest;
};
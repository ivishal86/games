import { Server } from "socket.io";
import { schedule } from 'node-cron';
import { subscribeToChannel } from "./marketClient";
import type { MatchData } from "../../../common/interfaces";
import { setCache } from "../../../common/cache/redis";
import { oddsMultipliers } from "../../../common/constants/odds";
import { getBetDelay } from "../../../common/utilities/commonFunction";

export async function getInplayMatches() {
    try {
        const url = process.env.INPLAY_MATCHES_URL;
        if (!url) throw new Error("INPLAY_MATCHES_URL missing");

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { data: matches = [] } = await res.json();

        const events: Record<string, string[]> = {};
        const result: any[] = [];

        for (const e of matches) {
            // console.log(JSON.stringify(e))
            const bookmaker = parseBookmakerData(e?.match_details?.bookmakerOddData);
            const fancy = parseFancyData(e?.match_details?.fancyOddData);
            // console.log(bookmaker,"booker")
            // console.log(fancy,"fancy")
            if (!e.has_trade_bet) continue;
            const betDelay: number = getBetDelay(e.bet_delay);
            const matchObj: any = {
                matchId: e.matchId,
                betDelay,
                eventId: e.event_id,
                eventName: e.event_name,
                eventDate: e.event_date,
                slug: e.slug,
                markets: []
            };

            const markets = e?.match_details?.matchOddData;
            if (!Array.isArray(markets)) continue;

            for (const market of markets) {
                if (market.st === "CLOSED" || !market.has_trade_bet || market.marketName.toLowerCase() == "who will win the match?") continue; //Removed Who will win the match market as per Ryan sir comments

                let {
                    mid, st, runners,
                    runnerName, marketName, has_trade_bet,
                    betFetchTimeMS, multiplier_unit, trade_bet_stake_limit,
                    odds_multiplier = oddsMultipliers
                } = market;

                // if (!Array.isArray(odds_multiplier) || !odds_multiplier.length) odds_multiplier = oddsMultipliers;
                // if (!trade_bet_stake_limit) trade_bet_stake_limit = 3;
                // if (!multiplier_unit) multiplier_unit = 1000;

                odds_multiplier = oddsMultipliers;
                trade_bet_stake_limit = 3;
                multiplier_unit = 500;

                odds_multiplier = odds_multiplier.map((el: any) => {
                    if (typeof el.max === "string" && el.max.toLowerCase() === "odd limit") {
                        return {
                            min: el.min,
                            max: trade_bet_stake_limit,
                            multiplier: el.multiplier
                        };
                    }
                    return el;
                });

                (events[e.event_id] ??= []).push(mid);

                const runner = e.runners?.[0]?.ex;
                const eventOdds = runner?.b?.[0]?.p ?? runner?.l?.[0]?.p ?? null;

                const cacheObj = {
                    ...matchObj,
                    mid, st, runners,
                    runnerName, marketName, has_trade_bet,
                    betFetchTimeMS, multiplier_unit, trade_bet_stake_limit,
                    odds_multiplier
                };

                subscribeToChannel(mid);
                setCache(mid, cacheObj);

                matchObj.markets.push({
                    marketName,
                    runnerName,
                    mid,
                    eventOdds,
                    has_trade_bet,
                    betFetchTimeMS,
                    multiplier_unit,
                    trade_bet_stake_limit,
                    odds_multiplier
                });
                matchObj.bookmaker = bookmaker;
                matchObj.fancy = fancy;
            }

            result.push(matchObj);
        };

        await setCache("events", events);
        return result;

    } catch (err: any) {
        console.error("Error fetching in-play matches:", err?.message);
        return [];
    }
};

function parseBookmakerData(bookmakerOddData: any) {
    if (!bookmakerOddData?.ml?.length) return null;
    // console.log(bookmakerOddData,"bookmaker")
    return {
        eventId: bookmakerOddData.eid,
        eventName: bookmakerOddData.en,
        markets: bookmakerOddData.ml.map((m: any) => ({
            marketId: m.id || m.mi,
            marketName: m.mn,
            minStake: m.mins,
            maxStake: Number(m.ms || 0),
            runners: (m.sl || []).map((r: any) => ({
                sid: r.si,
                name: r.sln,
                back: Number(r.b || 0),
                lay: Number(r.l || 0),
                status: r.ss
            }))
        }))
    };
}

function parseFancyData(fancyOddData: any) {
    if (!fancyOddData?.ml?.length) return null;
    // console.log("fanct+y",fancyOddData)
    return {
        eventId: fancyOddData.eid,
        eventName: fancyOddData.en,
        markets: fancyOddData.ml.map((m: any) => ({
            fancyId: m.mi,
            fancyName: m.mn,
            yesRate: Number(m.ry || 0),
            noRate: Number(m.rn || 0),
            minStake: Number(m.mins || 0),
            maxStake: Number(m.ms || 0),
            status: m.sn,
            category: m.cat
        }))
    };
}


async function syncInplayData() {
    const currentInplayData = await getInplayMatches();
    // console.log("currentInplayData",JSON.stringify(currentInplayData))
    if (!currentInplayData.length) return null;

    const now = Date.now();
    const liveMatches: MatchData[] = [];
    const upcomingMatches: MatchData[] = [];

    for (const match of currentInplayData) {
        let num = 0;
        // console.log(num++, JSON.stringify(match))
        const eventTime = new Date(match.eventDate).getTime();
        const target = eventTime > now ? upcomingMatches : liveMatches;
        target.push({
            evId: match.eventId,
            btDly: match.betDelay,
            odds: match.eventOdds,
            evNm: match.eventName,
            mktNm: match.markets,
            evDt: match.eventDate,
            bookmaker: match?.bookmaker,
            fancy: match?.fancy
        });
    }
    await setCache("currentMatches", liveMatches);
    await setCache("upcomingMatches", upcomingMatches);
    return { liveMatches, upcomingMatches };
};

export async function initMarketDataCron(io: Server) {
    schedule('*/30 * * * * *', async () => {
        await emitInplaydata(io);
    });
};

async function emitInplaydata(io: Server) {
    const matchData = await syncInplayData();
    if (!matchData) return;
    io.emit('markets', matchData);
    const allMatches = [
        ...(matchData.liveMatches || []),
        ...(matchData.upcomingMatches || [])
    ];
    // console.log(allMatches.map(m=>m))
    io.emit("bookmakerOdds", allMatches.map(m => m.bookmaker).filter(Boolean));
    io.emit("fancyOdds", allMatches.map(m => m.fancy).filter(Boolean));

};

/*

{
  "35047317": [ "-1.251546875", "1.251546877", "1.251546875" ],
  "35050496": [ "-1.251580035", "1.251580035" ],
  "35050541": [ "-1.251581052", "1.251581052" ],
  "35050626": [ "1.251584706", "1.251584708" ],
  "35050763": [ "1.251583788", "1.251583791" ],
  "35050871": [ "-1.251596004", "1.251596006", "1.251596004" ],
}

*/
export interface IMarketData {
    mid: number;
    st: string;
    runners: IRunnerExchange[];
}

export interface IRunnerExchange {
    ex: IExchange;
    sid: number;
}

export interface IExchange {
    l?: ILayBack[];
    b?: ILayBack[];
}

export interface ILayBack { p: number, s: string }

export interface IInfluxQueryResult { [key: string]: any };

export interface IGroupedExchange {
    [key: string]: {
        id: string,
        _time: string,
        odds: number,
        stake: number,
        status: number
    }
};

export interface RunnerData {
    RN: string;
    SID: number;
}

export interface MarketData {
    marketName: string;
    runnerName: RunnerData[];
    mid: string;
}

export interface MatchData {
    evId: string | number;
    evNm: string;
    mktNm: MarketData[]
    evDt: string | number;
    btDly: number;
    odds: string | null;
    bookmaker?: any;
    fancy?: any;

}

export type Trade = {
    user_id: string;
    event_name: string;
    win_amt: number;
    bonus: number;
};

export type UserSummary = {
    user_id: string;
    operator_id: string;
    win_amount: number;
};

export type EventReport = {
    event_name: string;
    total_user_win_amount: number;
    total_users_traded: number;
    win_users: number;
    loss_users: number;
    breakeven_users: number;
    users: UserSummary[];
};

export type EventItem = {
    event_name: string;
    event_start_date: Date;
};

export type DateWiseEvents = Record<string, EventItem[]>;

export interface BookmakerMarket {
    eventId: number;
    eventName: string;
    markets: Array<{
        marketId: number | string;
        marketName: string;
        minStake: number;
        maxStake: number;
        runners: Array<{
            sid: number | string;
            name: string;
            back: number;
            lay: number;
            status: string;
        }>;
    }>;
}

export interface FancyMarket {
    eventId: number;
    eventName: string;
    markets: Array<{
        fancyId: number | string;
        fancyName: string;
        yesRate: number;
        noRate: number;
        minStake: number;
        maxStake: number;
        status: string;
        category: string;
    }>;
}

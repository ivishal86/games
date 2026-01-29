export interface IDbTradeObject {
    user_id: string;
    operator_id: string;
    eventName: string;
    runnerName: string;
    marketName: string;
    eventDate: string;
    slug: string;
    trade_time: number;
    trade_odds: number;
    stake: number;
    cat: string;
    market_exchange: string;
    target_profit: number;
    stop_loss: number;
    max_cap: number;
}

export interface IDbSettlementObject extends IDbTradeObject {
    co_req_odds: number;
    co_odds: number;
    win_amt: number;
    balance: number;
    updated_balance: number;
    updated_balance_at: number;
    bonus: number;
    reason: string;
    status: string;
}

export interface ITransaction {
    user_id: string;
    operator_id: string;
    amount: number;
    updated_balance: number;
    session_token: string;
    type: "CREDIT" | "DEBIT";
    credit_txn_id?: string | null;
    debit_txn_id?: string | null;
}

export interface IWallet {
    user_id: string;
    operator_id: string;
    txn_id?: string;
    balance: number;
}

export interface IGlobalTrades {
    [key: string]: IUserTrade
}

export interface IUserTrade {
    ttlBl: number;
    ttlProfit: number;
    game_id: string | number;
    sId: string;
    user_id: string;
    operator_id: string;
    token: string;
    ttlStk: number;
    txnId: string;
    ip: string;
    isLiquidated: boolean;
    [key: string]: ITrade[] | number | string | boolean;
}

export interface ITrade {
    stake: number;
    odds: number;
    cat: string;
    runningOdds: number;
    profit: number;
    initialBalance: number;
    trdTm: number;
    updtBl: number;
    updtBlAt: number;
    isTgtMet: boolean;
    targetProfit: number;
    stopLoss: number;
    bonus: number;
}

export interface IInfluxExchange {
    id: string;
    odds: number;
    status: number;
    _time: Date;
    time_ms: number;
}

export interface ISocketPayload {
    event: string;
    [key: string]: string | number;
};

export type TradeExitIntent = {
    tradeKey: string;
    payload: string[];
    tradeBonus: number;
    sId: string;
    trade: ITrade
};

export type UpdateIntent =
    | { type: 'NONE' }
    | { type: 'TRADE_EXIT'; data: TradeExitIntent }
    | { type: 'USER_LIQUIDATION'; tradeKey: string, userTrade: IUserTrade };

export type IGlobalSlug = Record<string, string[]>;
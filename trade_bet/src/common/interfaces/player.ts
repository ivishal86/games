export interface IRawUserData {
    user_id: string;
    operatorId: string;
    balance: number;
    [key: string]: any;
};

export interface IWalletInfo {
    user_id: string;
    operator_id: string;
    balance: number;
    operatorBalance: number;
    txn_id?: string;
    token: string;
    game_id: string;
    id: string;
    isLocked: Boolean;
};

export interface Info extends IRawUserData {
    id: string;
    game_id: string;
    operator_id: string;
    token: string;
    image?: number;
};

export interface IWebhookData {
    txn_id: string;
    ip?: string;
    game_id: string | undefined;
    user_id: string;
    amount?: string | number;
    description?: string;
    trade_id?: string;
    txn_type?: number;
    txn_ref_id?: string;
};
export type WebhookKey = 'CREDIT' | 'DEBIT';

export interface IAccountsResult {
    txn_id?: string;
    status: boolean;
    type: WebhookKey
};


export interface IPlaceTradeData {
    id: string;
    trade_amount?: number | string;
    winning_amount?: number | string;
    game_id?: string;
    user_id: string;
    txn_id?: string;
    ip?: string;
};
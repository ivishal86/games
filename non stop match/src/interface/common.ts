import { ResultEnum } from "../enum/common";

export interface DebitObj {
  amount: string;
  txn_id: string;
  ip: string;
  game_id: number;
  user_id: string;
  description: string;
  bet_id: string;
  // socket_id:string;
  txn_type: number;
}
export interface BetRequest {
  webhookData:DebitObj,
  token:string,
  socketId:string
}
export interface ResultRequest {
  webhookData:CreditObj,
  token:string,
  operatorId:string
}
export interface CreditObj {
  amount: number;
  txn_id: string;
  ip: string;
  game_id: number;
  user_id: string;
  // bet_id: string,
  // socket_id: string,
  txn_ref_id : string,
  description: string;
  txn_type: number;
}

export interface BetObj {
  gameId:string;
  matchId: string;
  betAmount: number;
  debitTxnId: string;
  result?: 'win' | 'lose' | 'rollback';
  winAmount?: number;
  creditTxnId:string;
  ip:string
}
export interface BetData {
  betOn:number;
  payout?:number;
  multiplier?:number;
  betAmount?: number,
}
export interface WebhookData {
  gameId:string;
  matchId: string;
  betAmount: number;
  debitTxnId: string;
  result?: 'win' | 'lose' | 'rollback';
  winAmount?: number;
  creditTxnId:string;
  ip:string
}

export interface DebitData{
    status: Boolean,
    msg: string
}

export interface GameResult {
  result: ResultEnum;
  winAmount: number;
  updatedBalance: number;
  creditTxnId: string | null;
}

export interface PostBetTxnData {
  webhookData: DebitObj,
  token?: string,
  socketId?: string,
}

export interface UpdateBetResultParams {
  betId: string;
  betTxnId:string;
  userId:string;
  matchId:string;
  betResponse: string;
  betStatus?: string;
  betData:BetData[],
  betObj?:BetObj;
  isDeclared?: boolean;
  result: string;
  resultStatus?: ResultEnum;
  resultRequest?:ResultRequest;
  resultTxnId?: string;
  winAmount?: number;
}

export interface SaveBetInput {
  userId: string;
  betId: string;
  matchId: string;
  operatorId: string;
  betAmount: number;
  betRequest: BetRequest;
  // betResponse: string;
  betTxnId: string;
  isDeclared: boolean;
  resultStatus: string;
}

export interface JoinGamePayload {
  token: string;
  gameId: string;
}

export interface PlaceBetPayload {
  betString: string;
}
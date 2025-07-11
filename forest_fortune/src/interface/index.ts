import { ResultEnum } from "../enum/result.enum";
import { BetPayload } from "./forestFortune.interface";


export interface User {
  user_id: string;
  name: string;
  operatorId: string;
  balance: number;
  token:string;
  socket:string;
  gameId:string;
}

export interface SocketMessage {
  eventName: string;
  data: BetPayload;
}

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
  matchId: string;
  multiplier: number[];
  betAmount: number;
  debitTxnId: string;
  result?: 'win' | 'lose' | 'rollback';
  winAmount?: number;
  // game_id,  
  //  user_id: actualUserId, 
  // userId: encodedUserId,                                                                             
  // debit_txn_id,   credit_txn_id,  
  // socket_id,  
  // ip  
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

export interface BetAttributes {
  userId: string;
  betId: string;
  matchId: string;
  operatorId: string;
  betAmount: number;
  betData: object;
  betStatus: string;
  betRequest: object;
  BetResponse: string;
  betTxnId: string;
  isDeclared: boolean;
  result: object;
  resultStatus: string;
  resultTxnId: string;
  winAmount: number;
}

export interface PostBetTxnData {
  webhookData: DebitObj,
  token: string,
  socketId?: string,
}
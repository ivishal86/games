import { BetObj, BetRequest, ResultRequest } from ".";
// import { RiskLevel } from "../enum/forestFortune.enum";
import { ResultEnum } from "../enum/result.enum";

export interface BetPayload {
  betAmount: string;
  // risk: RiskLevel;
  // arrowsAmount: number;
  // betPerArrow: string;
}

export interface ArrowResult {
  arrowIndex: number;
  multiplier: number;
  arrowWinAmount: number;
  balance: number;
}
export interface BetData {
  // betOn:number,
  betAmount: number;
  payout: number;
}

export interface UpdateBetResultParams {
  betId: string;
  betTxnId:string;
  userId:string;
  matchId:string;
  betResponse: string;
  betStatus?: string;
  betData:BetData,
  betObj?:BetObj;
  isDeclared?: boolean;
  result?: string[];
  resultStatus?: ResultEnum;
  resultRequest?:ResultRequest;
  resultTxnId?: string;
  winAmount?: number;
}

export interface ArrowGameResponse {
  // isFinished: boolean;
  isWin: boolean;
  isMegaWin?:boolean,
  multiplier?:number;
  winAmount?: string;
  result:string[];
  balance: number;
}

export interface MatchHistoryRow {
  match_id: string;
  user_id: string;
  operator_id: string;
  bet_amount: number;
  win_amount: number;
  bet_data: string | BetObj;
  created_at: string;
}

// export interface UserBetRow extends RowDataPacket {
//   betId: string;
//   betAmount: number;
//   winAmount: number;
//   createdAt: string;
//   betData: string | BetObj;
// }

export interface UserBetHistory {
  match_id: string;
  user_id:string;
  bet_id: string;
  bet_amount: number;
  win_amount: number;
  bet_data: BetData;
  result: string;
  created_at:string;
  multiplier:string;
}

export interface AllBetHistory {
  // match_id: string;
  user_id:string;
  // bet_id: string;
  bet_amount: number;
  win_amount: number;
  // bet_data: BetData;
  // result: string;
  created_at:string;
  multiplier:string;
}

export interface SaveBetInput {
  userId: string;
  betId: string;
  matchId: string;
  operatorId: string;
  betAmount: number;
  // betData: BetObj;
  // betStatus: string;
  betRequest: BetRequest;
  // betResponse: string;
  betTxnId: string;
  isDeclared: boolean;
  resultStatus: string;
}
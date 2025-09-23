import { BetData, BetObj } from "./common";

export interface RollbackUpdateInput {
  betTransactionId: string;
  userId: string;
  matchId: string;
  resultStatus: string;
}

export interface MatchHistoryRow {
  matchId: string;
  userId: string;
  operatorId: string;
  betAmount: number;
  winAmount: number;
  betData: string | BetObj;
  createdAt: string;
}


export interface UserBetHistory {
  matchId: string;
  userId:string;
  betId: string;
  betAmount: number;
  winAmount: number;
  multiplier:string;
  betData: BetData;
  result: string|null;
  createdAt:string;
}
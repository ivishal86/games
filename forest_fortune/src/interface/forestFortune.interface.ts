import { BetObj, BetRequest, ResultRequest } from ".";
import { RiskLevel } from "../enum/forestFortune.enum";
import { ResultEnum } from "../enum/result.enum";
import { ArrowResultForDb } from "../utilities/helper";

export interface BetPayload {
  betAmount: number;
  risk: RiskLevel;
  arrowsAmount: number;
  betPerArrow: string;
}

export interface ArrowResult {
  arrowIndex: number;
  multiplier: number;
  arrowWinAmount: number;
  balance: number;
}
export interface BetData {
  arrowNumber: number;
  betAmount: number;
  multiplier: number;
  payout: number;
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
  result?: ArrowResultForDb[];
  resultStatus?: ResultEnum;
  resultRequest?:ResultRequest;
  resultTxnId?: string;
  winAmount?: number;
}

export interface ArrowGameResponse {
  isFinished: boolean;
  isWin: boolean;
  betAmount: string;
  coeff: string;
  risk: RiskLevel;
  winAmount: string;
  arrowsResultPositions: {
    coeff: string;
    winAmount: string;
  }[];
  updatedBalance: number;
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

// export interface UserBetRow extends RowDataPacket {
//   betId: string;
//   betAmount: number;
//   winAmount: number;
//   createdAt: string;
//   betData: string | BetObj;
// }

export interface UserBetHistory {
  matchId:string;
  betId: string;
  betAmount: number;
  winAmount: number;
  createdAt: string;
  multiplier: string;
  result:string;
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
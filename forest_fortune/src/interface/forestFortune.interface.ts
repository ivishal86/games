import { BetObj } from ".";
import { RiskLevel } from "../enum/forestFortune.enum";

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
  betId: string;
  betAmount: number;
  winAmount: number;
  createdAt: string;
  multiplier: string;
}
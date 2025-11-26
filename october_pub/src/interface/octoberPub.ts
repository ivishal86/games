import { BetObj, BetRequest, ResultRequest } from ".";
// import { RiskLevel } from "../enum/forestFortune.enum";
import { ResultEnum } from "../enum/result.enum";

export interface BetPayload {
  betAmount: string;
  betOn:string;
}

export interface BetData {
  // betOn:number,
  // betAmount: number;
  // payout: number;
  state:GameState
}
export interface BetDataDB {
  betAmount: number;
  payout: number;
  multiplier:number
}
export interface ResultDB {
  glassId: number;
  open: boolean;
  fillLevel:number;
  alive:boolean;
  winAmount:number
}
export interface UpdateBetResultParams {
  betId: string;
  betTxnId:string;
  userId:string;
  matchId:string;
  roundId:string;
  betResponse?: string;
  betStatus?: string;
  betData?:BetDataDB|null,
  betObj?:BetObj;
  isDeclared?: boolean;
  result?: ResultDB|null;
  resultStatus?: ResultEnum;
  resultRequest?:ResultRequest;
  resultTxnId?: string;
  winAmount?: number;
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

export interface SaveBetInput {
  userId: string;
  betId: string;
  matchId: string;
  operatorId: string;
  betAmount: number;
  // betData: BetObj;
  // betStatus: string;
  betRequest: BetRequest;
  betResponse: string;
  betTxnId: string;
  isDeclared: boolean;
  resultStatus: string;
  roundId:string;
}

export interface Cup {
  id: number;
  open: boolean;
  fillLevel: number; // 0-5
  alive: boolean;
  winAmount: number;
}


export interface GameState {
  userId: string;
  operatorId: string;

  cups: Cup[];
  selected: number[];
  allowed: number[];

  perBetAmount: number; // fixed from START command
  win: number;
  totalBetAmount: number;
  // lastBet?: { cupId: number; amount: number; ts: number } | null;
}

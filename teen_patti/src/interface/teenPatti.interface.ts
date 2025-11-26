import { BetObj, BetRequest, ResultRequest } from ".";
import { HandRank, ResultEnum } from "../enum/result.enum";

export interface BetPayload {
  bets: { betOn: string; amount: string }[];
}

export interface BetData {
  betOn: string; // e.g., "player", "dealer", "split", "player pair", "dealer flush"
  betAmount: number;
  payout: number;
  multiplier: number;
}

export interface UpdateBetResultParams {
  betId: string;
  betTxnId: string;
  userId: string;
  matchId: string;
  betResponse: string;
  betStatus?: string;
  betData: BetData[],
  betObj?: BetObj;
  isDeclared?: boolean;
  result?: ResultDb;
  resultStatus?: ResultEnum;
  resultRequest?: ResultRequest;
  resultTxnId?: string;
  winAmount?: number;
}

export interface GameResponse {
  // isFinished: boolean;
  // isWin: boolean;
  dealerHand: Card[],
  playerHand: Card[],
  multiplier?: number;
  winAmount?: string;
  // betOn:string;
  result: string;
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
  bet_id: string;
  user_id: string;
  match_id: string;
  bet_amount: number;
  win_amount: number;
  multiplier: string;
  bet_data: BetData[];
  result: any;
  dealer_total: string | number;
  player_total: string | number;
  created_at: string;
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

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J,12=Q,13=K,14=A


// export interface Card { suit: Suit; rank: Rank }
export type Hand = [Card, Card, Card];


export interface HandEval {
  rank: HandRank;
  // used for tie-breaking; already normalized for A-2-3 and A-K-Q
  tiebreak: number[]; // length 3, desc
  // extra info for side bets
  isFlush: boolean;
  isSequence: boolean;
  isTrio: boolean;
  isPair: boolean;
}


export type SideKind = 'PAIR' | 'FLUSH' | 'SEQUENCE' | 'PURE_SEQUENCE' | 'TRAIL';
export type SideTarget = 'DEALER' | 'PLAYER';


export interface Card {
  suit: string;
  rank: number;
}

export interface HandEvaluation {
  type: number;
  values: number[];
}

// export interface SideBet {
//   side: 'player' | 'dealer';
//   condition: string;
//   amount: number;
// }
export interface Bet {
  betOn: 'player' | 'dealer' | 'split' | `${'player' | 'dealer'} ${'pair' | 'flush' | 'straight' | '3 of a kind' | 'straight flush'}`;
  amount: number;
}
export interface Bets {
  bets: Bet[];
}

export interface GameResult {
  playerHand: Card[];
  dealerHand: Card[];
  mainResult: 'player' | 'dealer' | 'split';
  payouts: { betOn: string; payout: number }[];
  playerType: number;
  dealerType: number;
}

export interface ResultDb {
  dealerHand: Card[];
  playerHand: Card[];
  result: string;
}
import { Socket } from "socket.io";
import { BetObj, DebitObj } from "./common";
export interface Bet {
  userId: string;
  operatorId: string;
  gameId:string,
  socket: Socket;
  roundId: string;
  totalAmount: number;
  betBreakdown: { HOME: number; AWAY: number; DRAW: number };
  debitTxnId?: string;
  betObj?: BetObj;
  debitObj?: DebitObj;
  debitMsg?: string;
}

export interface BetPayload {
  betAmount:string,
  betOn:string;
}
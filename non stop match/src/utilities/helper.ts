import { Socket } from "socket.io";
import { BetData, BetObj, PlaceBetPayload } from "../interface/common";
import { redisClient, setHashField } from "./redis-connecton";
import { v7 as uuidv7 } from 'uuid';
import { emitMessage } from "./common";

export async function cacheBetToRedis(redisKey: string, betData: BetObj, socket: Socket, user:Record<string, string>): Promise<void> {
  const redisData: Record<string, string> = {
    matchId: betData.matchId,
    game_id:betData.gameId,
    betAmount: String(betData.betAmount),
    debitTxnId: betData.debitTxnId,
    // winAmount: String(betData.winAmount),
    ip: socket.handshake.address,
    userId:user.user_id,
    operatorId:user.operatorId
  };
  await setHashField(redisKey, redisData);
}

export async function getBalance(userId: string, operatorId: string): Promise<number> {
  const key = `user:${userId}:${operatorId}`;
  const balance = await redisClient.hget(key, 'balance');
  return parseFloat(balance ?? '0');
}

export async function updateBalance(userId: string, operatorId: string, amount: number): Promise<void> {
  const key = `user:${userId}:${operatorId}`;
  await redisClient.hincrbyfloat(key, 'balance', amount);
}

export function validateArrowGameData(socket:Socket, data:PlaceBetPayload) {
  // ✅ Basic structure validation
  if (!data?.betString || typeof data.betString !== 'string') {
    socket.emit("message", { error: "Invalid bet data format." });
    return false;
  }

  // const regex = /^PB:(\d+-\d+)(,\d+-\d+)*$/;
  // if (!regex.test(data.betString)) {
  //   socket.emit("message", { error: "Invalid bet string format." });
  //   return false;
  // }

  const bets = data.betString.slice(3).split(","); // Remove "PB:"
  const allowedBets = new Set([1, 2, 3]);
  const betOnSet = new Set();
  let totalAmount = 0;

  for (const bet of bets) {
    const [betOnStr, betAmountStr] = bet.split("-");
    const betOn = Number(betOnStr);
    const betAmount = Number(betAmountStr);

    // ✅ Check valid betOn
    if (!allowedBets.has(betOn)) {
      emitMessage(socket, 'ERROR', { message: `Invalid betOn '${betOn}'. Allowed values are 1, 2, or 3.` });
      return false;
    }

    // ✅ Duplicate check (fixed)
    if (betOnSet.has(betOn)) {
      emitMessage(socket, 'ERROR', { message: `Duplicate bet detected on '${betOn}'. You can only bet once per type.` });
      return false;
    }
    betOnSet.add(betOn);

    // ✅ Validate betAmount
    if (isNaN(betAmount) || betAmount < 10) {
      emitMessage(socket, 'ERROR', { message: `Invalid betAmount '${betAmount}'. Minimum allowed is 10.` });
      return false;
    }

    totalAmount += betAmount;

    // ✅ Validate total limit
    if (totalAmount > 20000) {
      emitMessage(socket, 'ERROR', { message: "Total bet amount cannot exceed 20000." });
      return false;
    }
  }

  return true; // ✅ Passed all checks
}

export function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
export const generateUUIDv7 = (): string => uuidv7();

export function buildBetDataDb(betObj: Record<string, number>, result: string): BetData[] {
  const betDataDb: BetData[] = [];

  if (!betObj || typeof betObj !== 'object') return betDataDb;

  const DRAW_MULTIPLIER = parseFloat(process.env.DRAW || '12');
  const OTHER_MULTIPLIER = parseFloat(process.env.OTHER || '2');
  const OTHER_WITHDRAW_MULTIPLIER = parseFloat(process.env.OTHERWITHDRAW || '0.5');

  // Map bet type names to numbers for compatibility
  const betTypeMap: Record<string, number> = { HOME: 1, AWAY: 2, DRAW: 3 };

  // Check if DRAW bet is present and > 0
  const hasBetType3 = !!betObj.DRAW && betObj.DRAW > 0;

  for (const [type, amount] of Object.entries(betObj)) {
    const betType = betTypeMap[type];
    const betAmount = Number(amount);

    if (!betType || betAmount <= 0 || isNaN(betAmount)) continue;

    let multiplier = 0;
    let payout = 0;

    if (result === 'DRAW') {
      if (betType === 3) {
        multiplier = DRAW_MULTIPLIER;
      } else if (betType === 1 || betType === 2) {
        multiplier = hasBetType3 ? 0 : OTHER_WITHDRAW_MULTIPLIER;
      }
    } else if (result === 'HOME' && betType === 1) {
      multiplier = OTHER_MULTIPLIER;
    } else if (result === 'AWAY' && betType === 2) {
      multiplier = OTHER_MULTIPLIER;
    }

    payout = betAmount * multiplier;

    betDataDb.push({
      betOn: betType,
      betAmount,
      multiplier,
      payout,
    });
  }

  return betDataDb;
}

export function calculateAverageMultiplier(betAmount: number, winAmount:number): string {
  try {
    // if (!Array.isArray(betData) || betData.length === 0) return '0';

    // const betAmounts: number[] = betData.map(bet => Number(bet.betAmount));
    // const sum = betAmounts.reduce((acc, val) => acc + val, 0);
    let avg = winAmount / betAmount

    const formatted =
      Number.isInteger(avg) ? `${avg}` : `${avg.toFixed(3).replace(/\.?0+$/, '')}`;

    return formatted;
  } catch {
    return '0';
  }
}
import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from '../enum/result.enum';
import { ArrowGameResponse, BetData, BetPayload } from '../interface/headAndTails.interface';
import { BetObj, BetRequest, DebitObj, GameResult, ResultRequest } from '../interface';
import { Socket } from 'socket.io';
import { emitError } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, processWinTransaction, updateUserBalance } from './common';
import config from '../config/config';
import { getRedisClient, setHashField } from './redis-connecton';
import { saveBetToDB, updateBetResult } from './db-queries';

export const DECIMALS = 2;

export async function calculateCoinFlipResult(
  betAmount: number,
  betOn: number,
  initialBalance: number,
  socket: Socket,
  redisKey: string
): Promise<GameResult> {
  const multiplier = config.multiplier;
  let winAmount = 0;
  const totalBetAmount = betAmount;
  let runningBalance = initialBalance - totalBetAmount;
  let arr = [1, 2, 1, 2, 1, 2, 1, 2]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const resultNumber = arr[Math.floor(Math.random() * arr.length)];

  if (resultNumber == betOn) {
    winAmount = betAmount * multiplier;
    winAmount = Number(winAmount.toFixed(2));
  }
  const result = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;
  runningBalance += winAmount;
  // Final Redis update
  const redisClient = getRedisClient()
  await redisClient.hset(redisKey, { balance: String(runningBalance) });
  void updateUserBalance(socket, runningBalance); // async balance update internally
  return {
    result,
    winAmount,
    updatedBalance: Number(runningBalance.toFixed(2)),
    resultNumber
  };
}

export function formatGameResponse(
  // totalBetAmount: number,
  betOn: string,
  winAmount: number,
  updatedBalance: number,
  resultNumber: number
): ArrowGameResponse {
  if (winAmount > 0) {
    return {
      isFinished: true,
      isWin: winAmount > 0,
      multiplier: winAmount > 0 ? 1.9 : 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      betOn,
      winAmount: winAmount.toFixed(DECIMALS),
      result: resultNumber,
      updatedBalance
    };
  } else {
    return {
      isFinished: true,
      isWin: winAmount < 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      betOn,
      result: resultNumber,
      updatedBalance
    }
  }
}


export function validateBetData(socket: Socket, data: BetPayload): boolean {
  if (socket.data.userInfo.balance < data.betAmount) return emitValidationError(socket, `Insufficient Balance`);
  if (
    !validateFieldPresence(socket, data, ['betAmount', "betOn"]) ||
    !validateFieldType(socket, data) ||
    !validateNumberRange(socket, 'betAmount', Number(data.betAmount), Number(config.bet.MIN_BET), Number(config.bet.MAX_BET)) ||
    !validateBetOn(socket, Number(data.betOn))
  ) {
    return false;
  }

  return true;
}

export function emitValidationError(socket: Socket, message: string): false {
  emitError(socket, message);
  return false;
}

function validateFieldPresence(socket: Socket, data: BetPayload, fields: (keyof BetPayload)[]): boolean {
  for (const key of fields) {
    if (!(key in data)) {
      return emitValidationError(socket, `Missing required field: ${key}`);
    }
    if (data[key] == undefined) {
      return emitValidationError(socket, `Missing required field: ${key}`);
    }
  }
  return true;
}
function validateFieldType(socket: Socket, data: BetPayload,): boolean {
  if (isNaN(Number(data.betAmount))) {
    return emitValidationError(socket, `Bet Amount should be a Integer.`);
  }
  if (isNaN(Number(data.betOn))) {
    return emitValidationError(socket, `Bet On should be a Integer.`);
  }
  return true;
}
function validateNumberRange(socket: Socket, fieldName: string, value: number, min: number, max: number): boolean {
  if (typeof value !== 'number') {
    return emitValidationError(socket, `${fieldName} must be a number`);
  }
  if (value < min || value > max) {
    return emitValidationError(socket, `${fieldName} must be between ${min} and ${max}`);
  }
  return true;
}
function validateBetOn(socket: Socket, betOn: number): boolean {
  // ✅ Must be integer and either 1 or 2
  if (!Number.isInteger(betOn) || (betOn !== 1 && betOn !== 2)) {
    return emitValidationError(socket, `Bet can only be placed on 1 or 2`);
  }
  return true;
}

export function getGameConfig(): Record<string, object | number> {
  const chip = ["10", "20", "50", "100", "500", "1k", "5k", "10k", "20k"]
  return {
    chip,
    minBet: config.bet.MIN_BET,
    maxBet: config.bet.MAX_BET
  };
}

export function calculateAverageMultiplier(betAmount: number, winAmount: number): string {
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

export function getBetRedisKey(socket: Socket, matchId: string): string {
  return `BT:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}:${matchId}`;
}

export async function getUserFromRedis(socket: Socket, matchId: string): Promise<Record<string, string> | null> {
  const redisClient = getRedisClient()
  const user = await redisClient.hgetall(`user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`);
  if (!user || !user.userId || !user.balance) {
    void logError('User data not found in Redis', { matchId, socketId: socket.id });
    emitError(socket, 'User data not found');
    return null;
  }
  return user;
}

export function buildBetData(socket: Socket, matchId: string, multiplier: number, betAmount: number, gameId: string, betOn: number): BetObj {
  return {
    gameId,
    matchId,
    multiplier,
    betAmount,
    betOn,
    debitTxnId: uuidv7(),
    result: ResultEnum.lose,
    winAmount: 0,
    creditTxnId: uuidv7(),
    ip: socket.handshake.address || 'unknown'
  };
}

export async function cacheBetToRedis(redisKey: string, betData: BetObj, socket: Socket, user: Record<string, string>): Promise<void> {
  const redisData: Record<string, string> = {
    matchId: betData.matchId,
    game_id: betData.gameId,
    betAmount: String(betData.betAmount),
    debitTxnId: betData.debitTxnId,
    // winAmount: String(betData.winAmount),
    ip: socket.handshake.address,
    userId: user.userId,
    operatorId: user.operatorId
  };
  await setHashField(redisKey, redisData);
}

export async function saveInitialBetToDB(socket: Socket, matchId: string, debitObj: DebitObj, betRequest: BetRequest, betObj: BetObj): Promise<void> {
  await saveBetToDB({
    userId: decodeURIComponent(socket.data.userInfo.user_id),
    betId: debitObj.bet_id,
    matchId,
    operatorId: socket.data.userInfo.operatorId,
    betAmount: betObj.betAmount,
    // betData,
    // betStatus: 'pending',
    betRequest,
    betTxnId: betObj.debitTxnId,
    isDeclared: false,
    resultStatus: ResultEnum.lose
  });
}

export async function handleBetResult(
  resultEnum: ResultEnum,
  winAmount: number,
  creditTxnId: string | null,
  betData: BetData,
  betObj: BetObj,
  debitObj: DebitObj,
  socket: Socket,
  result: number,
  token: string,
  matchId: string,
  msg: string,
  user: Record<string, string>
): Promise<void> {
  if (resultEnum === ResultEnum.win && winAmount > 0 && creditTxnId) {
    const creditObj = createCreditObject(winAmount, creditTxnId, socket, matchId, betObj.debitTxnId);
    const resultRequest: ResultRequest = {
      webhookData: creditObj,
      token,
      operatorId: user.operatorId
    }
    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId: debitObj.txn_id,
      userId: user.userId,
      matchId,
      betData,
      betObj,
      betResponse: msg,
      betStatus: 'success',
      isDeclared: true,
      result,
      resultRequest,
      resultStatus: ResultEnum.win,
      resultTxnId: creditTxnId,
      winAmount
    }, "win");
    await processWinTransaction(creditObj, socket, token, matchId);
  } else {
    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId: debitObj.txn_id,
      userId: user.userId,
      matchId,
      betData,
      betObj,
      result,
      betResponse: msg,
      betStatus: 'success',
      isDeclared: true
    }, 'lose');
  }
}

// type UserBetData = {
//   betAmount: number;
//   betOn: number;
// };

export function buildBetDataDb(
  betAmount: number,
  betOn: number,
  winAmount: number
): BetData {
  // const perArrowBet = Number(betData.betPerArrow);

  // return arrowsResultPositions.slice(0, betData.arrowsAmount).map((result, index) => {
  //   const multiplier = parseFloat(result.coeff);
  //   const payout = +(perArrowBet * multiplier).toFixed(2);

  return {
    betOn,
    betAmount,
    payout: winAmount,
  };
  // });
}
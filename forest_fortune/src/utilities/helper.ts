import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from '../enum/result.enum';
import { MULTIPLIERS, RiskLevel } from '../enum/forestFortune.enum';
import { ArrowGameResponse, ArrowResult, BetPayload } from '../interface/forestFortune.interface';
import { BetObj, DebitObj, GameResult } from '../interface';
import { Socket } from 'socket.io';
import { emitError, emitSocketMessage } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, processWinTransaction, saveBetToDB, updateBetResult, updateUserBalance } from './common';
import { EVENT_TYPES } from '../socket/events';
import config from '../config/config';
import { redisClient, setHashField } from './redis-connecton';

export const DECIMALS = 2;
export function getMultipliers(risk: RiskLevel, count: number): number[] {
  const options = MULTIPLIERS[risk];
  return Array.from({ length: count }, () => options[Math.floor(Math.random() * options.length)]);
}


export async function calculateArrowGameResult(
  multipliers: number[],
  betPerArrow: number,
  initialBalance: number,
  socket: Socket,
  redisKey: string
): Promise<GameResult & { arrowResults: ArrowResult[] }> {
  const arrowResults: ArrowResult[] = [];
  let winAmount = 0;
  const totalBetAmount = betPerArrow * multipliers.length;
  let runningBalance = initialBalance - totalBetAmount;

  for (let index = 0; index < multipliers.length; index++) {
    const multiplier = multipliers[index];
    const arrowWinAmount = betPerArrow * multiplier;
    runningBalance += arrowWinAmount;

    const resultObj: ArrowResult = {
      arrowIndex: index + 1,
      multiplier,
      arrowWinAmount,
      balance: runningBalance
    };

    arrowResults.push(resultObj);

    // ✅ Update balance in Redis after each arrow
    // await redisClient.hset(redisKey, { balance: String(runningBalance) });

    // Optionally: log after each update
    // void logInfo(`Arrow ${index + 1} updated Redis balance: ${runningBalance}`);
    
    winAmount += arrowWinAmount;
  }

  const result = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;
  const creditTxnId = winAmount > 0 ? uuidv7() : null;

  // Final Redis update
  await redisClient.hset(redisKey, { balance: String(runningBalance) });
  void updateUserBalance(socket, runningBalance); // async balance update internally

  return {
    result,
    winAmount,
    updatedBalance: runningBalance,
    creditTxnId,
    arrowResults
  };
}

export function formatArrowGameResponse(
  risk: RiskLevel,
  totalBetAmount: number,
  winAmount: number,
  arrowResults: ArrowResult[],
  updatedBalance: number
): ArrowGameResponse {
  return {
    isFinished: true,
    isWin: winAmount > 0,
    betAmount: totalBetAmount.toFixed(DECIMALS),
    coeff: (winAmount / totalBetAmount).toFixed(DECIMALS),
    risk,
    winAmount: winAmount.toFixed(DECIMALS),
    arrowsResultPositions: arrowResults.map(res => ({
      coeff: res.multiplier.toFixed(DECIMALS),
      winAmount: res.arrowWinAmount.toFixed(DECIMALS),
      balance: res.balance.toFixed(DECIMALS),
    })),
    updatedBalance
  };
}


export function validateArrowGameData(socket: Socket, data: BetPayload): boolean {
  if (
    !validateFieldPresence(socket, data, ['betAmount', 'risk', 'arrowsAmount', 'betPerArrow']) ||
    !validateNumberRange(socket, 'betAmount', data.betAmount, Number(config.bet.MIN_BET), Number(config.bet.MAX_BET)) ||
    !validateRiskLevel(socket, data.risk) ||
    !validateNumberRange(socket, 'arrowsAmount', data.arrowsAmount, Number(config.bet.MIN_ARROWS), Number(config.bet.MAX_ARROWS)) ||
    !validateBetPerArrow(socket, data.betPerArrow)
  ) {
    return false;
  }

  return true;
}

function emitValidationError(socket: Socket, message: string): false {
  emitError(socket, message);
  return false;
}

function validateFieldPresence(socket: Socket, data: BetPayload, fields: string[]): boolean {
  for (const key of fields) {
    if (!(key in data)) {
      return emitValidationError(socket, `Missing required field: ${key}`);
    }
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

function validateRiskLevel(socket: Socket, risk: RiskLevel): boolean {
  if (typeof risk !== 'number') {
    return emitValidationError(socket, 'risk must be a number');
  }
  if (!Object.values(RiskLevel).includes(risk)) {
    return emitValidationError(
      socket,
      `Invalid risk level. Must be one of: ${Object.values(RiskLevel).join(', ')}`
    );
  }
  return true;
}

function validateBetPerArrow(socket: Socket, betPerArrow: string): boolean {
  if (typeof betPerArrow !== 'string') {
    return emitValidationError(socket, 'betPerArrow must be a string');
  }
  if (isNaN(Number(betPerArrow))) {
    return emitValidationError(socket, 'betPerArrow must be a numeric string');
  }
  return true;
}
export function getGameConfig(): Record<number, number[]> {
  return {
    [RiskLevel.EASY]: MULTIPLIERS[RiskLevel.EASY]
  };
}

export function handleDifficultyChange(socket: Socket, data: { risk: unknown }): void {
  const numericRisk = Number(data.risk);

  if (!Object.values(RiskLevel).includes(numericRisk)) {
    emitSocketMessage({
      socket,
      eventName: EVENT_TYPES.Error,
      data: `Invalid risk level selected: ${JSON.stringify(data.risk)}`,
    });
    return;
  }

  const multipliers = MULTIPLIERS[numericRisk as RiskLevel];

  emitSocketMessage({
    socket,
    eventName: EVENT_TYPES.DIFFICULTY_CHANGE,
    data: {
      riskLevel: numericRisk,
      multipliers,
    },
  });
}

export function calculateAverageMultiplier(betData: BetObj): string {
  try {
    const multipliers: number[] = Array.isArray(betData?.multiplier)
      ? betData.multiplier.map(Number)
      : [];

    if (multipliers.length === 0) return '0';

    const sum = multipliers.reduce((acc, val) => acc + val, 0);
    const avg = sum / multipliers.length;

    const formatted =
      Number.isInteger(avg) ? `${avg}` : `${avg.toFixed(DECIMALS).replace(/\.?0+$/, '')}`;

    return formatted;
  } catch {
    return '0';
  }
}

export function getBetRedisKey(socket: Socket, matchId: string): string {
  return `BT:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}:${matchId}`;
}

export async function getUserFromRedis(socket: Socket, matchId: string): Promise<Record<string, string> | null> {
  const user = await redisClient.hgetall(`user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`);
  if (!user || !user.userId || !user.balance) {
    void logError('User data not found in Redis', { matchId, socketId: socket.id });
    emitError(socket, 'User data not found');
    return null;
  }
  return user;
}

export function buildBetData(matchId: string, multiplier: number[], betAmount: number): BetObj {
  return {
    matchId,
    multiplier,
    betAmount,
    debitTxnId: uuidv7(),
    result: ResultEnum.lose,
    winAmount: 0
  };
}

export async function cacheBetToRedis(redisKey: string, betData: BetObj, socket: Socket, user:Record<string, string>): Promise<void> {
  const redisData: Record<string, string> = {
    matchId: betData.matchId,
    betAmount: String(betData.betAmount),
    debitTxnId: betData.debitTxnId,
    winAmount: String(betData.winAmount),
    ip: socket.handshake.address,
    userId:user.user_id,
    operatorId:user.operatorId
  };
  await setHashField(redisKey, redisData);
}

export async function saveInitialBetToDB(socket: Socket, matchId: string, debitObj: DebitObj, betData: BetObj): Promise<void> {
  await saveBetToDB({
    userId: decodeURIComponent(socket.data.userInfo.user_id),
    betId: debitObj.bet_id,
    matchId,
    operatorId: socket.data.userInfo.operatorId,
    betAmount: betData.betAmount,
    betData,
    betStatus: 'pending',
    betRequest: debitObj,
    betTxnId: betData.debitTxnId,
    isDeclared: false,
    resultStatus: ResultEnum.lose
  });
}

export async function handleBetResult(
  result: ResultEnum,
  winAmount: number,
  creditTxnId: string | null,
  betData: BetObj,
  debitObj: DebitObj,
  socket: Socket,
  token: string,
  matchId: string,
  msg: string
): Promise<void> {
  if (result === ResultEnum.win && winAmount > 0 && creditTxnId) {
    const creditObj = createCreditObject(winAmount, creditTxnId, socket, matchId, betData.debitTxnId);
    await updateBetResult({
      betId: debitObj.bet_id,
      betResponse: msg,
      betStatus: 'completed',
      isDeclared: true,
      result: creditObj,
      resultStatus: ResultEnum.win,
      resultTxnId: creditTxnId,
      winAmount
    });
    await processWinTransaction(creditObj, socket, token, matchId);
  } else {
    await updateBetResult({
      betId: debitObj.bet_id,
      betResponse: msg,
      betStatus: 'completed',
      isDeclared: true
    });
  }
}

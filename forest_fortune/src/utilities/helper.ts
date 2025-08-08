import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from '../enum/result.enum';
import { gameMultipliers, MULTIPLIERS, RiskLevel } from '../enum/forestFortune.enum';
import { ArrowGameResponse, ArrowResult, BetData, BetPayload } from '../interface/forestFortune.interface';
import { BetObj, BetRequest, DebitObj, GameResult, ResultRequest } from '../interface';
import { Socket } from 'socket.io';
import { emitError, emitSocketMessage } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, processWinTransaction, updateUserBalance } from './common';
import { EVENT_TYPES } from '../socket/events';
import config from '../config/config';
import { getRedisClient, redisClient, setHashField } from './redis-connecton';
import { saveBetToDB, updateBetResult } from './db-queries';

export const DECIMALS = 2;
// export function getMultipliers(risk: RiskLevel, count: number): number[] {
//   const options = MULTIPLIERS[risk];
//   return Array.from({ length: count }, () => options[Math.floor(Math.random() * options.length)]);
// }

export function getMultipliers(risk: RiskLevel, count: number): number[] {
  const tiers = MULTIPLIERS[risk]; // tiers: number[][]
  return Array.from({ length: count }, () => {
    const tier = tiers[Math.floor(Math.random() * tiers.length)];
    return tier[Math.floor(Math.random() * tier.length)];
  });
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

  // Final Redis update
  const redisClient = getRedisClient()
  await redisClient.hset(redisKey, { balance: String(runningBalance) });
  void updateUserBalance(socket, runningBalance); // async balance update internally

  return {
    result,
    winAmount,
    updatedBalance: Number(runningBalance.toFixed(DECIMALS)),
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
  if (socket.data.userInfo.balance < data.betAmount) return emitValidationError(socket, `Insufficient Balance`);
  if (
    !validateFieldPresence(socket, data, ['betAmount', 'risk', 'arrowsAmount', 'betPerArrow']) ||
    !validateNumberRange(socket, 'betAmount', data.betAmount, Number(config.bet.MIN_BET), Number(config.bet.MAX_BET)) ||
    !validateRiskLevel(socket, data.risk) ||
    !validateArrowRange(socket, 'arrowsAmount', data.arrowsAmount, Number(config.bet.MIN_ARROWS), Number(config.bet.MAX_ARROWS)) ||
    !validateBetPerArrow(socket, data.betPerArrow)
  ) {
    return false;
  }

  return true;
}

export function emitValidationError(socket: Socket, message: string): false {
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
  // if (socket.data.userInfo.balance < min) return emitValidationError(socket, `Insufficient Balance`);
  if(value < min){
    return emitValidationError(socket, `Invalid bet amount (Min: ${min})`);
  }
  if(value > max){
    return emitValidationError(socket, `Invalid bet amount (Max: ${max})`);
  }
  if (value < min || value > max) {
    return emitValidationError(socket, `${fieldName} must be between ${min} and ${max}`);
  }
  return true;
}
function validateArrowRange(socket: Socket, fieldName: string, value: number, min: number, max: number): boolean {
  if (typeof value !== 'number') {
    return emitValidationError(socket, `${fieldName} must be a number`);
  }
  // if (socket.data.userInfo.balance < min) return emitValidationError(socket, `Insufficient Balance`);
  if(value < min){
    return emitValidationError(socket, `Invalid Arrow Count (Min: ${min})`);
  }
  if(value > max){
    return emitValidationError(socket, `Invalid Arrow Count (Max: ${max})`);
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
    [RiskLevel.EASY]: gameMultipliers[RiskLevel.EASY]
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

  const multipliers = gameMultipliers[numericRisk as RiskLevel];

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
    if (!Array.isArray(betData) || betData.length === 0) return '0';

    const multipliers: number[] = betData.map(bet => Number(bet.multiplier));
    const sum = multipliers.reduce((acc, val) => acc + val, 0);
    const avg = sum 

    const formatted =
      Number.isInteger(avg) ? `${avg}` : `${avg.toFixed(2).replace(/\.?0+$/, '')}`;

    return formatted;
  } catch {
    return '0';
  }
}

export function calculateAverageMultipliers(betAmount: number, winAmount:number): string {
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

export function buildBetData(socket:Socket,matchId: string, multiplier: number[], betAmount: number,gameId:string): BetObj {
  return {
    gameId,
    matchId,
    multiplier,
    betAmount,
    debitTxnId: uuidv7(),
    result: ResultEnum.lose,
    winAmount: 0,
    creditTxnId:uuidv7(),
    ip:socket.handshake.address || 'unknown'
  };
}

export async function cacheBetToRedis(redisKey: string, betData: BetObj, socket: Socket, user:Record<string, string>): Promise<void> {
  const redisData: Record<string, string> = {
    matchId: betData.matchId,
    game_id:betData.gameId,
    betAmount: String(betData.betAmount),
    debitTxnId: betData.debitTxnId,
    // winAmount: String(betData.winAmount),
    ip: socket.handshake.address,
    userId:user.userId,
    operatorId:user.operatorId
  };
  await setHashField(redisKey, redisData);
}

export async function saveInitialBetToDB(socket: Socket, matchId: string, debitObj: DebitObj,betRequest:BetRequest, betObj: BetObj): Promise<void> {
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
  betData:BetData[],
  betObj: BetObj,
  debitObj: DebitObj,
  socket: Socket,
  result:ArrowResultForDb[],
  token: string,
  matchId: string,
  msg: string,
  user:Record<string,string>
): Promise<void> {
  if (resultEnum === ResultEnum.win && winAmount > 0 && creditTxnId) {
    const creditObj = createCreditObject(winAmount, creditTxnId, socket, matchId, betObj.debitTxnId);
    const resultRequest : ResultRequest={
      webhookData:creditObj,
      token,
      operatorId:user.operatorId
    }
    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId:debitObj.txn_id,
      userId:user.userId,
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
    },'win');
    await processWinTransaction(creditObj, socket, token, matchId);
  } else {
    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId:debitObj.txn_id,
      userId:user.userId,
      matchId,
      betData,
      betObj,
      result,
      betResponse: msg,
      betStatus: 'success',
      isDeclared: true
    },'lose');
  }
}

export type ArrowResultForDb = {
  coeff: string;     // Multiplier as string
  winAmount: string; // Not needed here but part of original object
};

type UserBetData = {
  betAmount: number;
  risk: number;
  arrowsAmount: number;
  betPerArrow: string;
};

// type ArrowBetResult = {
//   arrowNumber: number;
//   betAmount: number;
//   multiplier: number;
//   payout: number;
// };

export function buildBetDataDb(
  betData: UserBetData,
  arrowsResultPositions: ArrowResultForDb[]
): BetData[] {
  const perArrowBet = Number(betData.betPerArrow);

  return arrowsResultPositions.slice(0, betData.arrowsAmount).map((result, index) => {
    const multiplier = parseFloat(result.coeff);
    const payout = +(perArrowBet * multiplier).toFixed(2);

    return {
      arrowNumber: index + 1,
      betAmount: perArrowBet,
      multiplier,
      payout,
    };
  });
}
import { v7 as uuidv7 } from 'uuid';
import { GameResponse, BetData, BetPayload, Strip } from '../interface/cryptos';
import { BetObj, BetRequest, DebitObj, GameResult, ResultRequest } from '../interface';
import { Socket } from 'socket.io';
import { emitSocketMessage } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, processWinTransaction, updateUserBalance } from './common';
import config from '../config/config';
import { getRedisClient, resetCounter, setHashField } from './redis-connecton';
import { saveBetToDB, updateBetResult } from './db-queries';
import { ResultEnum } from '../enum/result.enum';
import { EVENT_TYPES } from '../socket/events';
import axios from 'axios';

export const DECIMALS = 2;

export async function calculateSlotsResult(
  betAmount: number,
  initialBalance: number,
  socket: Socket,
  redisKey: string,
  gameId: number,
  userId:string
): Promise<GameResult> {
  let response: any;
  const redisClient = getRedisClient()
  let countStr = await redisClient.get(`Counter:Cryptos`);
  const count = countStr !== null ? Number(countStr) : 0;
  console.log(count, "<------------count");
  let slots = config.SLOT_OUTCOMES.map(outcomes =>
        outcomes[Math.floor(Math.random() * outcomes.length)]
      );
  if (count >= 30) {
    response = await axios.get(`${config.MULTIPLIER_URL}/game/get-result`, {
      params: { game_id: gameId, count },
      headers: { "Content-Type": "application/json" }
    });
    console.log("API:win or pass", response.data);
  
  const shouldControlPayout =
    response &&
    response.data &&
    response.data.data?.status === true
  // Number(response.data.data?.probability) === 0;
  if (shouldControlPayout) {
    if (Number(response.data.data?.probability) === 0) {
      console.log("manipulated---------------------------")
      slots = config.LOSING_SLOTS.map(outcomes =>
        outcomes[Math.floor(Math.random() * outcomes.length)]
      );
    }
  }
  else {
    await resetCounter(`Counter:Cryptos`)
    slots = config.SLOT_OUTCOMES.map(outcomes =>
      outcomes[Math.floor(Math.random() * outcomes.length)]
    );
  }
}
  // const slots = drawSlotsByCategory()
  const multiplier = calculateMultiplierFromPattern(slots);
  let winAmount = 0;
  const totalBetAmount = betAmount;
  let runningBalance = initialBalance - totalBetAmount;
  winAmount = betAmount * multiplier;
  const result = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;
  runningBalance += winAmount;
  // Final Redis update
  // const redisClient = getRedisClient()
  await redisClient.hset(redisKey, { balance: String(runningBalance) });
  void updateUserBalance(socket, runningBalance); // async balance update internally

  // winAmount = Number(betAmount) * multiplier;
  return {
    result,
    winAmount,
    updatedBalance: Number(runningBalance.toFixed(2)),
    slots,
    multiplier
  }
}

export function formatGameResponse(
  // totalBetAmount: number,
  multiplier: number,
  winAmount: number,
  updatedBalance: number,
  slots: object
): GameResponse {
  if (winAmount > 0) {
    return {
      isFinished: true,
      isWin: winAmount > 0,
      multiplier,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      winAmount: winAmount.toFixed(DECIMALS),
      slots,
      updatedBalance
    };
  } else {
    return {
      isFinished: true,
      isWin: winAmount < 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      slots,
      updatedBalance
    }
  }
}


export async function validateBetData(socket: Socket, data: BetPayload): Promise<boolean> {
  let key = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`
  const redisClient = getRedisClient()
  let balance = await redisClient.hget(key, 'balance')
  // console.log(balance,"balance------------------------")
  if (Number(balance) < Number(data.betAmount)) {
    emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: `Insufficient Balance` })
    return false;
  }
  if (
    !validateFieldPresence(socket, data, ['betAmount']) ||
    !validateFieldType(socket, data) ||
    !validateNumberRange(socket, 'betAmount', Number(data.betAmount), Number(config.bet.MIN_BET), Number(config.bet.MAX_BET))
  ) {
    return false;
  }

  return true;
}

function validateFieldPresence(socket: Socket, data: BetPayload, fields: (keyof BetPayload)[]): boolean {
  for (const key of fields) {
    if (!(key in data)) {
      emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: `Missing required field: ${key}` });
      return false;
    }
    if (data[key] == undefined) {
      emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: `Missing required field: ${key}` });
      return false;
    }
  }
  return true;
}
function validateFieldType(socket: Socket, data: BetPayload,): boolean {
  if (isNaN(Number(data.betAmount))) {
    emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: `Bet Amount should be a Integer.` });
    return false;
  }
  return true;
}
function validateNumberRange(socket: Socket, fieldName: string, value: number, min: number, max: number): boolean {
  if (typeof value !== 'number') {
    emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: `${fieldName} must be a number` });
    return false;
  }
  if (value < min || value > max) {
    emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: `${fieldName} must be between ${min} and ${max}` });
    return false;
  }
  return true;
}

export function calculateAverageMultiplier(betAmount: number, winAmount: number): string {
  try {
    // if (!Array.isArray(betData) || betData.length === 0) return '0';

    // const betAmounts: number[] = betData.map(bet => Number(bet.betAmount));
    // const sum = betAmounts.reduce((acc, val) => acc + val, 0);
    const avg = winAmount / betAmount

    const formatted =
      Number.isInteger(avg) ? `${avg}` : `${avg.toFixed(3).replace(/\.?0+$/, '')}`;

    return formatted;
  } catch {
    return '0';
  }
}

export async function getUserFromRedis(socket: Socket, matchId: string): Promise<Record<string, string> | null> {
  const redisClient = getRedisClient()
  const user = await redisClient.hgetall(`user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`);
  if (!user || !user.userId || !user.balance) {
    void logError('User data not found in Redis', { matchId, socketId: socket.id });
    void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "User data not found" })
    return null;
  }
  return user;
}

export function buildBetData(socket: Socket, matchId: string, multiplier: number, betAmount: number, gameId: string): BetObj {
  return {
    gameId,
    matchId,
    multiplier,
    betAmount,
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
  slots: object,
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
      userId: decodeURIComponent(user.userId),
      matchId,
      betData,
      betObj,
      betResponse: msg,
      betStatus: 'success',
      isDeclared: true,
      result: slots,
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
      userId: decodeURIComponent(user.userId),
      matchId,
      betData,
      betObj,
      result: slots,
      betResponse: msg,
      betStatus: 'success',
      isDeclared: true
    }, 'lose');
  }
}

export function buildBetDataDb(
  betAmount: number,
  winAmount: number
): BetData {
  // const perArrowBet = Number(betData.betPerArrow);

  // return arrowsResultPositions.slice(0, betData.arrowsAmount).map((result, index) => {
  //   const multiplier = parseFloat(result.coeff);
  //   const payout = +(perArrowBet * multiplier).toFixed(2);

  return {
    betAmount,
    payout: winAmount,
  };
  // });
}

export function drawSlots(): number[] {
  return config.SLOT_OUTCOMES.map(outcomes =>
    outcomes[Math.floor(Math.random() * outcomes.length)]
  );
}


const SLOT_MULTIPLIERS = {
  "5": 70.97,
  "4": 14.12,
  "3-2": 4.24,
  "3": 2.12,
  "2-2": 1.06,
  "2": 0.45,
  "0": 0.30
};

// Generate all ordered permutations of 3 distinct symbols (336 strips)
const symbols = [0, 1, 2, 3, 4, 5, 6, 7];
const strips: Strip[] = [];
for (let i = 0; i < symbols.length; i++) {
  for (let j = 0; j < symbols.length; j++) {
    if (j === i) continue;
    for (let k = 0; k < symbols.length; k++) {
      if (k === i || k === j) continue;
      strips.push([i, j, k]);
    }
  }
}

// Your existing calculateMultiplierFromPattern (unchanged, but included for completeness)
export function calculateMultiplierFromPattern(slots: number[]): number {
  const counts: Record<number, number> = {};
  slots.forEach(num => counts[num] = (counts[num] || 0) + 1);
  const freq = Object.values(counts).sort((a, b) => b - a);

  // Check highest-value / composite patterns first
  if (freq[0] === 5) return SLOT_MULTIPLIERS["5"];
  if (freq[0] === 4) return SLOT_MULTIPLIERS["4"];
  if (freq[0] === 3 && freq[1] === 2) return SLOT_MULTIPLIERS["3-2"];

  // TWO PAIRS must be checked before single PAIR
  if (freq[0] === 2 && freq[1] === 2) return SLOT_MULTIPLIERS["2-2"];

  if (freq[0] === 3) return SLOT_MULTIPLIERS["3"];
  if (freq[0] === 2) return SLOT_MULTIPLIERS["2"];
  return SLOT_MULTIPLIERS["0"];
}

// Your existing shuffle (unchanged)
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from '../enum/result.enum';
import { BetDataDB, BetPayload, Cup, GameState, ResultDB } from '../interface/octoberPub';
import { BetObj, BetRequest, CreditObj, DebitObj, ResultRequest } from '../interface';
import { Socket } from 'socket.io';
import { emitError } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, processWinTransaction } from './common';
import config, { MULTIPLIERS } from '../config/config';
import { createRedisClient, getRedisClient, redisClient, setHashField } from './redis-connection';
import { saveBetToDB, updateBetResult } from './db-queries';
import { GAME_KEY, USER_KEY } from '../module/game/gamePlay';

export const DECIMALS = 2;

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

// export function getGameConfig(): Record<string, object | number> {
//   return {
//     minBet: config.bet.MIN_BET,
//     maxBet: config.bet.MAX_BET
//   };
// }

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

export function getBetRedisKey(socket: Socket, roundId: string): string {
  return `BT:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}:${roundId}`;
}

export async function getUserFromRedis(socket: Socket): Promise<Record<string, string> | null> {
  const redisClient = getRedisClient()
  const user = await redisClient.hgetall(`user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`);
  if (!user || !user.userId || !user.balance) {
    void logError('User data not found in Redis', { socketId: socket.id });
    emitError(socket, 'User data not found');
    return null;
  }
  return user;
}

export function buildBetData(
  socket: Socket,
  matchId: string,
  multiplier: number,
  betAmount: number,
  gameId: string,
  glassId: number
): BetObj {
  return {
    gameId,
    matchId,
    multiplier,
    betAmount,
    glassId,
    debitTxnId: uuidv7(),
    creditTxnId: uuidv7(),
    result: ResultEnum.lose,
    winAmount: 0,
    ip: socket.handshake.address || 'unknown'
  };
}

export async function cacheBetToRedis(redisKey: string, betData: BetObj, socket: Socket, user: Record<string, string>, roundId: string): Promise<void> {
  const redisData: Record<string, string> = {
    matchId: roundId,
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

export async function saveInitialBetToDB(socket: Socket, matchId: string, debitObj: DebitObj, betRequest: BetRequest, betObj: BetObj, roundId: string, txnId: string, msg: string): Promise<void> {
  await saveBetToDB({
    userId: decodeURIComponent(socket.data.userInfo.user_id),
    betId: debitObj.bet_id,
    matchId,
    operatorId: socket.data.userInfo.operatorId,
    betAmount: betObj.betAmount,
    // betData,
    // betStatus: 'pending',
    betRequest,
    betResponse: msg,
    betTxnId: txnId,
    isDeclared: false,
    resultStatus: ResultEnum.lose,
    roundId
  });
}
export async function handleBetResult(
  resultEnum: ResultEnum,
  winAmount: number,
  creditTxnId: string | null,
  betData: BetDataDB | null,
  betObj: BetObj,
  debitObj: DebitObj,
  socket: Socket,
  result: ResultDB | null,
  token: string,
  matchId: string,
  user: Record<string, string>,
  roundId: string,
  msg?: string,
): Promise<void> {

  if (resultEnum === ResultEnum.win && winAmount > 0 && creditTxnId) {

    const creditObj: CreditObj = createCreditObject(
      winAmount,
      creditTxnId,
      debitObj.txn_id,        // <-- REFERENCE debit txnId correct!
      socket,
      roundId,
      user.gameId,
      user.userId
    );

    const resultRequest: ResultRequest = {
      webhookData: creditObj,
      token,
      operatorId: user.operatorId
    };

    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId: debitObj.txn_id,
      userId: decodeURIComponent(user.userId),
      matchId,
      roundId,
      betData,
      betObj,
      betResponse: msg,
      betStatus: "success",
      isDeclared: true,
      result,
      resultRequest,
      resultStatus: ResultEnum.win,
      resultTxnId: creditTxnId,
      winAmount
    }, "win");

    await processWinTransaction(creditObj, socket, token, matchId, roundId);
  }

  else {
    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId: debitObj.txn_id,
      userId: decodeURIComponent(user.userId),
      matchId,
      betData,
      betObj,
      result,
      betResponse: msg,
      betStatus: "success",
      isDeclared: true,
      roundId
    }, "lose");
  }
}

export function buildBetDataDb(
  state: GameState, id: number
): BetDataDB {
  // const perArrowBet = Number(betData.betPerArrow);

  // return arrowsResultPositions.slice(0, betData.arrowsAmount).map((result, index) => {
  //   const multiplier = parseFloat(result.coeff);
  //   const payout = +(perArrowBet * multiplier).toFixed(2);
  const result = state.cups[id - 1];
  const formateResult = {
    // betOn,
    betAmount: state.perBetAmount,
    payout: result.winAmount,
    multiplier: result.winAmount / state.perBetAmount
  }
  return formateResult
  // });
}
export function buildResultDb(
  state: GameState, id: number
): ResultDB {
  // const perArrowBet = Number(betData.betPerArrow);

  // return arrowsResultPositions.slice(0, betData.arrowsAmount).map((result, index) => {
  //   const multiplier = parseFloat(result.coeff);
  //   const payout = +(perArrowBet * multiplier).toFixed(2);
  const result = state.cups[id - 1];
  const formateResult = {
    glassId:result.id,
    open:result.open,
    fillLevel:result.fillLevel,
    alive:result.alive,
    winAmount:result.winAmount
  }
  return formateResult
  // });
}

export function parseCsvInts(s: string): number[] {
  if (!s.trim()) return [];
  return s
    .split(",")
    .map((n) => parseInt(n.trim(), 10))
    .filter((x) => Number.isInteger(x) && x >= 1 && x <= 5);
}
// export function emit(socket: Socket, event: string, data: any) {
//   socket.emit("message", { event, data });
// }
export async function loadState(userId: string, operatorId: string): Promise<GameState | null> {
  let raw
  if (redisClient) {
    raw = await redisClient.hget(GAME_KEY(userId), "state");
  }
  if (!raw) return null;

  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export async function saveState(state: GameState) {
  if (redisClient) {
    await redisClient.hset(GAME_KEY(state.userId), "state", JSON.stringify(state));
  }
}

const DEFAULT_CUPS = (): Cup[] =>
  [1, 2, 3, 4, 5].map((id) => ({
    id,
    open: false,
    fillLevel: 0,
    alive: true,
    winAmount: 0,
  }));

export async function resetState(userId: string, operatorId: string): Promise<GameState> {
  const state: GameState = {
    userId,
    operatorId,

    cups: DEFAULT_CUPS(),
    selected: [],
    allowed: [],

    perBetAmount: 0,
    totalBetAmount: 0,
    win: 0,
    // lastBet: null,
  };

  await saveState(state);
  return state;
}

export async function deleteState(userId: string) {
  let key = GAME_KEY(userId);
  const redisClient = getRedisClient();
  await redisClient.del(key)
}

export function rebuildAllowed(selected: number[], cups: Cup[]) {
  const alive = new Set(cups.filter((c) => c.alive).map((c) => c.id));
  return selected.filter((id) => alive.has(id));
}

/* ---------------------------------------------
   doBet()  → handles win/lose logic
---------------------------------------------- */
export async function doBet(state: GameState, cupId: number, amount: number, user: any): Promise<{ updated: GameState; result: "WIN" | "LOSE"; deltaWin: number }> {
  // operate on a clone
  const cups = state.cups.map((c) => ({ ...c }));
  const idx = cups.findIndex((c) => c.id === cupId);
  if (idx < 0) throw new Error("Cup not found");

  const cup = cups[idx];
  if (!cup.alive) throw new Error("Cup is dead");

  // 50% chance win
  // const win = Math.random() < 0.5;
  const win = true;
  let delta = 0;
  let cupWin = 0;
  if (win) {
    cup.fillLevel = Math.min(5, cup.fillLevel + 1);
    // delta uses multiplier based on NEW fillLevel
    const multiplier = MULTIPLIERS[cup.fillLevel] ?? 1;
    delta = amount * multiplier;
    // increase state.win by the delta
    if (cup.fillLevel > 1) {
      let nagateAmount = amount * MULTIPLIERS[cup.fillLevel - 1];
      state.win = state.win - nagateAmount;
      state.win = state.win + delta;
    } else {
      state.win = Number((state.win + delta).toFixed(2));
    }
    // set winAmount for UI — I preserve your earlier approach: show last win on cup
    console.log(cup, "cup-------------")
    console.log(state.totalBetAmount, "before  state---------------")
    if (cup.fillLevel <= 1 && cup.alive) {
      state.totalBetAmount += state.perBetAmount;
    }
    cup.winAmount = delta;

    if (cup.fillLevel === 5) cup.alive = false;
  } else {
    // lose → cup dies, winAmount = 0
    if (cup.fillLevel < 1 && cup.alive) {
      state.totalBetAmount += state.perBetAmount;
      cup.alive = false;
      cup.winAmount = 0;
    } else {
      cup.alive = false;
      state.win -= cup.winAmount
      cup.winAmount = 0;
    }
  }
  cups[idx] = cup;

  const updated: GameState = {
    ...state,
    cups,
    allowed: rebuildAllowed(state.selected, cups),
    // lastBet: { cupId, amount, ts: Date.now() },
  };

  await saveState(updated);
  const newstate = (await loadState(user.userId, user.operatorId))!;
  console.log(newstate.totalBetAmount, "after  state---------------")
  return { updated, result: win ? "WIN" : "LOSE", deltaWin: delta }
}

export async function getUserInfo(userId: string, operatorId: string) {
  const key = USER_KEY(userId, operatorId);
  const redisClient = createRedisClient();
  const data = await redisClient.hgetall(key);

  return {
    userId: data.user_id,
    balance: Number(data.balance || 0),
    operatorId: data.operatorId
  };
}

export async function cleanupGameStates() {
  const redis = getRedisClient();
  const pattern = "octoberPub:gameState:*";

  try {
    let cursor = "0";

    do {
      const reply = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );

      cursor = reply[0];
      const keys = reply[1];

      if (keys.length > 0) {
        await redis.del(...keys);
        console.log("Deleted keys:", keys);
      }

    } while (cursor !== "0");

    console.log("✔ All octoberPub:gameState:* keys deleted.");
  } catch (err) {
    console.error("Redis cleanup error:", err);
  }
}
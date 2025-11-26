import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from '../enum/result.enum';
import { ArrowGameResponse, BetData, BetPayload } from '../interface/headAndTails.interface';
import { BetObj, BetRequest, DebitObj, GameResult, ResultRequest } from '../interface';
import { Socket } from 'socket.io';
import { emitError, emitSocketMessage } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, processWinTransaction, updateUserBalance } from './common';
import config from '../config/config';
import { getRedisClient, resetCounter, setHashField } from './redis-connecton';
import { getLastRounds, saveBetToDB, updateBetResult } from './db-queries';
import { innerWheel, middleWheel, outerWheel } from '../enum/megaWheel.enum';
import axios from 'axios';

export const DECIMALS = 2;

export async function calculateCoinFlipResult(
  betAmount: number,
  initialBalance: number,
  socket: Socket,
  redisKey: string,
  gameId: number
): Promise<GameResult> {
  const resultObj = await calculateMultiplier(gameId);
  if (!resultObj) {
    throw new Error("Failed to calculate multiplier");
  }

  const { multiplier, resultArr } = resultObj;
  let winAmount = 0;
  const totalBetAmount = betAmount;
  let runningBalance = initialBalance - totalBetAmount;
  winAmount = Number((betAmount * Number(multiplier)).toFixed(2))
  const result = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;
  runningBalance += winAmount;
  // Final Redis update
  const redisClient = getRedisClient()
  await redisClient.hset(redisKey, { balance: String(runningBalance) });
  void updateUserBalance(socket, runningBalance);
  return {
    result,
    winAmount,
    updatedBalance: Number(runningBalance.toFixed(2)),
    resultArr
  };
}
function shuffleWheeel(arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
async function calculateMultiplier(gameId: number) {
  const redisClient = getRedisClient();
  const countStr = await redisClient.get(`Counter:MegaWheel`);
  const count = countStr !== null ? Number(countStr) : 0;
  const resultArr: string[] = [];
  if (count >= 30) {
    const response = await axios.get(`${config.MULTIPLIER_SERVER}/game/get-result`, {
      params: { game_id: gameId, count },
      headers: { "Content-Type": "application/json" },
    });
    console.log("API:win or pass", response.data);
    const data = response.data?.data;
    const shouldControlPayout =
      response &&
      response.data &&
      response.data.data?.status === true

    if (shouldControlPayout) {
      if (Number(response.data.data?.probability) === 0) {
        console.log("manipulated---------------------------")
        // Step 4: Force a losing condition for the player
        // Check if user bet on dealer
        const wheel1 = config.multiplier.wheel1;
        void shuffleWheeel(wheel1);
        const wheel2 = config.multiplier.wheel2;
        void shuffleWheeel(wheel2);
        const wheel3 = config.multiplier.wheel3;
        void shuffleWheeel(wheel3);
        let multiplier = wheel1[Math.floor(Math.random() * wheel1.length)];
        resultArr.push(multiplier);
        if (multiplier == "next") {
          multiplier = wheel2[Math.floor(Math.random() * wheel2.length)];
          resultArr.push(multiplier);
        }
        if (multiplier == "next") {
          multiplier = wheel3[Math.floor(Math.random() * wheel3.length)];
          resultArr.push(multiplier);
        }
        return { multiplier, resultArr };

      }
    } else {
      console.log("Normal Teen Patti round");
      await resetCounter(`Counter:MegaWheel`);
    }
  }
    // STEP 1 → pick from inner wheel
    let result: string = pickFromWheelGroup(innerWheel) as string;
    resultArr.push(result);

    // STEP 2 → go to middle wheel only if "next"
    if (result === "next") {
      result = pickFromWheelGroup(middleWheel) as string;
      resultArr.push(result);
    }

    // STEP 3 → go to outer wheel only if still "next"
    if (result === "next") {
      result = pickFromWheelGroup(outerWheel) as string;
      resultArr.push(result);
    }

    return {
      multiplier: result,
      resultArr,
    };
  }


export function formatGameResponse(
  // totalBetAmount: number,
  winAmount: number,
  updatedBalance: number,
  resultArr: string[]
): ArrowGameResponse {
  let isMegaWin: boolean = false;
  if (resultArr.length > 2 && resultArr[2] === '35' || resultArr[2] === '10') {
    isMegaWin = true
  }
  if (winAmount > 0) {
    return {
      // isFinished: true,
      isWin: winAmount > 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      // betOn,
      isMegaWin,
      winAmount: winAmount.toFixed(DECIMALS),
      result: resultArr,
      balance: updatedBalance
    };
  } else {
    return {
      // isFinished: true,
      isWin: winAmount < 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      // betOn,
      result: resultArr,
      balance: updatedBalance
    }
  }
}


export async function validateBetData(socket: Socket, data: BetPayload): Promise<boolean> {
  let key = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`
  const redisClient = getRedisClient()
  let balance = await redisClient.hget(key, 'balance')
  // console.log(balance,"balance------------------------")
  if (Number(balance) < Number(data.betAmount)) {
    return emitValidationError(socket, `Insufficient Balance`);
  }
  if (
    !validateFieldPresence(socket, data, ['betAmount']) ||
    !validateFieldType(socket, data) ||
    !validateNumberRange(socket, 'betAmount', Number(data.betAmount), Number(config.bet.MIN_BET), Number(config.bet.MAX_BET))
    // !validateBetOn(socket, Number(data.betOn))
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
  // if (isNaN(Number(data.betOn))) {
  //   return emitValidationError(socket, `Bet On should be a Integer.`);
  // }
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
// function validateBetOn(socket: Socket, betOn: number): boolean {
//   // ✅ Must be integer and either 1 or 2
//   if (!Number.isInteger(betOn) || (betOn !== 1 && betOn !== 2)) {
//     return emitValidationError(socket, `Bet can only be placed on 1 or 2`);
//   }
//   return true;
// }

export function getGameConfig(): Record<string, object | number> {
  return {
    minBet: config.bet.MIN_BET,
    maxBet: config.bet.MAX_BET,
    multiplier: {
      wheel1: ["x0.5", "0", "x1.5", "x1", "x0.5", "0", "next"],
      wheel2: ["x1.5", "next", "x2", "0", "x1.5", "x5", "x2", "0"],
      wheel3: ["x3", "x35", "x2", "x3", "x2", "0", "x10", "x2", "x3", "0", "x2", "x3", "x10", "0", "x3", "x2"]
    },
  };
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

export function buildBetData(socket: Socket, matchId: string, betAmount: number, gameId: string): BetObj {
  return {
    gameId,
    matchId,
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
  result: string[],
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
      userId: decodeURIComponent(user.userId),
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
  // betOn: number,
  winAmount: number
): BetData {
  // const perArrowBet = Number(betData.betPerArrow);

  // return arrowsResultPositions.slice(0, betData.arrowsAmount).map((result, index) => {
  //   const multiplier = parseFloat(result.coeff);
  //   const payout = +(perArrowBet * multiplier).toFixed(2);

  return {
    // betOn,
    betAmount,
    payout: winAmount,
  };
  // });
}

//-----------------userDashboard history event------------------------
export const userDashboardHistory = async (socket: Socket) => {
  const userId = socket.data?.userInfo?.user_id;

  if (!userId) {
    console.error("User ID not found in socket data");
    return socket.emit("error", "User not authenticated");
  }

  try {
    const historyEntries = await getLastRounds(userId);

    emitSocketMessage({
      socket,
      action: "ROUND_HISTORY",
      message: historyEntries
    });

  } catch (error) {
    console.error("Error fetching user history:", error);
    socket.emit("error", "Failed to fetch user history");
  }
};


function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickFromWheelGroup(groups: any[][]): string | number {
  const randomGroup = pickRandom(groups);  // pick one bucket
  return pickRandom(randomGroup);          // pick a value inside bucket
}
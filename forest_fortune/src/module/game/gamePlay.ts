import { BetPayload } from "../../interface/forestFortune.interface";
import { emitError } from "../../routes/event.routes";
import { createDebitObject, postBetTxn, updateUserBalance, emitThrowResult } from "../../utilities/common";
import { validateArrowGameData, getMultipliers, calculateArrowGameResult, formatArrowGameResponse, handleBetResult, saveInitialBetToDB, cacheBetToRedis, getBetRedisKey, buildBetData, getUserFromRedis, buildBetDataDb, emitValidationError } from "../../utilities/helper";
import { logSocket, logInfo, logError } from "../../utilities/logger";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { getRedisClient } from "../../utilities/redis-connecton";
import { BetRequest } from "../../interface";

let cashOutArray: string[] = [];
export async function throwArrow(socket: Socket, io: Server, data: BetPayload): Promise<void> {
  try {
    void logSocket('Arrow throw initiated', { socketId: socket.id, payload: data });
    const token = socket?.handshake.query.token
    if (!validateArrowGameData(socket, data)) return;

    const matchId = uuidv7();
    const user = await getUserFromRedis(socket, matchId);
    if (!user) return;
    let betBalance = data.arrowsAmount * Number(data.betPerArrow)
    if (data.betAmount != betBalance) {
      emitValidationError(socket, `Bet Amount Must be Valid According to Bet Per Arrow multiply Arrows count.`);
      return
    }
    const multiplier = getMultipliers(data.risk, data.arrowsAmount);
    const betObj = buildBetData(socket, matchId, multiplier, data.betAmount, user.gameId);
    const debitObj = createDebitObject(data.betAmount, betObj.debitTxnId, socket, matchId, user.gameId, user.userId);
    const redisKey = getBetRedisKey(socket, matchId);

    await cacheBetToRedis(redisKey, betObj, socket, user);
    const betRequest: BetRequest = {
      webhookData: debitObj,
      token: token as string,
      socketId: socket?.id
    }
    await saveInitialBetToDB(socket, matchId, debitObj, betRequest, betObj);

    const debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id }, socket);
    if (!debitData.status) {
      const redisClient = getRedisClient()
      await redisClient.del(redisKey);
      return;
    }

    await updateUserBalance(socket, Number(user.balance) - data.betAmount);
    console.log(user.balance)
    const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
    const { result, winAmount, updatedBalance, arrowResults } = await calculateArrowGameResult(
      multiplier,
      Number(data.betPerArrow),
      Number(user.balance),
      socket,
      balanceKey
    );

    betObj.result = result;
    betObj.winAmount = winAmount;
    const userCashOutKey = `${debitObj.bet_id}:${matchId}`
    const findUserCashout = cashOutArray.find((id) => id === userCashOutKey);
    if (findUserCashout) {
      emitError(socket, "bet under process");
      return;
    }
    cashOutArray.push(userCashOutKey)
    const responsePayload = formatArrowGameResponse(data.risk, data.betAmount, winAmount, arrowResults, updatedBalance);
    const betDataDb = buildBetDataDb(data, responsePayload.arrowsResultPositions);
    await handleBetResult(result, winAmount, betObj.creditTxnId, betDataDb, betObj, debitObj, socket, responsePayload.arrowsResultPositions, user.token, matchId, debitData.msg, user);
    cashOutArray = cashOutArray.filter(item => !item.includes(userCashOutKey));
    emitThrowResult(socket, responsePayload);
    const redisClient = getRedisClient()
    await redisClient.del(redisKey);

    void logInfo(`[END] Spin handled - MatchID: ${matchId}, UserID: ${user.userId}`);
  } catch (err) {
    void logError('Arrow Game Error', {
      message: (err as Error).message,
      stack: (err as Error).stack,
      socketId: socket.id
    });

    emitError(socket, (err as Error).message,);
  }
}
import { BetPayload } from "../../interface/forestFortune.interface";
import { emitError } from "../../routes/event.routes";
import { createDebitObject, postBetTxn, updateUserBalance, emitThrowResult } from "../../utilities/common";
import { validateArrowGameData, getMultipliers, calculateArrowGameResult, formatArrowGameResponse, handleBetResult, saveInitialBetToDB, cacheBetToRedis, getBetRedisKey, buildBetData, getUserFromRedis } from "../../utilities/helper";
import { logSocket, logInfo, logError } from "../../utilities/logger";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { redisClient } from "../../utilities/redis-connecton";

export async function throwArrow(socket: Socket, io: Server, data: BetPayload): Promise<void> {
  try {
    void logSocket('Arrow throw initiated', { socketId: socket.id, payload: data });

    if (!validateArrowGameData(socket, data)) return;

    const matchId = uuidv7();
    const user = await getUserFromRedis(socket, matchId);
    if (!user) return;

    const multiplier = getMultipliers(data.risk, data.arrowsAmount);
    const betData = buildBetData(matchId, multiplier, data.betAmount);
    const debitObj = createDebitObject(data.betAmount, betData.debitTxnId, socket, matchId, user.gameId, user.userId);
    const redisKey = getBetRedisKey(socket, matchId);

    await cacheBetToRedis(redisKey, betData, socket, user);
    await saveInitialBetToDB(socket, matchId, debitObj, betData);

    const debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id });
    if (!debitData.status) {
      await redisClient.del(redisKey);
      return;
    }

    await updateUserBalance(socket, Number(user.balance) - data.betAmount);
    console.log(user.balance)
    const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
    const { result, winAmount, updatedBalance, creditTxnId, arrowResults } =await calculateArrowGameResult(
      multiplier,
      Number(data.betPerArrow),
      Number(user.balance),
      socket,
      balanceKey
    );

    betData.result = result;
    betData.winAmount = winAmount;

    const responsePayload = formatArrowGameResponse(data.risk, data.betAmount, winAmount, arrowResults, updatedBalance);

    await handleBetResult(result, winAmount, creditTxnId, betData, debitObj, socket, user.token, matchId, debitData.msg);

    emitThrowResult(socket, responsePayload);
    await redisClient.del(redisKey);

    void logInfo(`[END] Spin handled - MatchID: ${matchId}, UserID: ${user.userId}`);
  } catch (err) {
    void logError('Arrow Game Error', {
      message: (err as Error).message,
      stack: (err as Error).stack,
      socketId: socket.id
    });

    emitError(socket, 'Internal Server Error');
  }
}
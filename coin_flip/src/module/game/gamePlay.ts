import { BetPayload } from "../../interface/headAndTails.interface";
import { emitError, emitSocketMessage } from "../../routes/event.routes";
import { createDebitObject, postBetTxn, updateUserBalance, emitResult } from "../../utilities/common";
import { handleBetResult, saveInitialBetToDB, cacheBetToRedis, getBetRedisKey, buildBetData, getUserFromRedis, buildBetDataDb, calculateCoinFlipResult, formatGameResponse, validateBetData } from "../../utilities/helper";
import { logSocket, logInfo, logError } from "../../utilities/logger";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { getRedisClient } from "../../utilities/redis-connecton";
import { BetRequest } from "../../interface";
import config from "../../config/config";
import { EVENT_TYPES } from "../../socket/events";

let cashOutArray: string[] = [];
export async function placeBet(socket: Socket, io: Server, data: BetPayload): Promise<void> {
  try {
    void logSocket('Arrow throw initiated', { socketId: socket.id, payload: data });
    const token = socket?.handshake.query.token
    if (!validateBetData(socket, data)) return;

    const matchId = uuidv7();
    const user = await getUserFromRedis(socket, matchId);
    if (!user) return;

    const betObj = buildBetData(socket, matchId, config.multiplier, Number(data.betAmount), user.gameId,Number(data.betOn));
    const debitObj = createDebitObject(Number(data.betAmount), betObj.debitTxnId, socket, matchId, user.gameId, user.userId);
    const redisKey = getBetRedisKey(socket, matchId);

    await cacheBetToRedis(redisKey, betObj, socket, user);
    const betRequest: BetRequest = {
      webhookData: debitObj,
      token: token as string,
      socketId: socket?.id
    }
    
    const debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id }, socket);
    if (!debitData.status) {
      const redisClient = getRedisClient()
      await redisClient.del(redisKey);
      emitError(socket,"Bet Cancelled by Upstream Server.")
      return;
    }
    await saveInitialBetToDB(socket, matchId, debitObj, betRequest, betObj);
    emitSocketMessage({socket,action:"betPlaced",message:(Number(user.balance) - Number(data.betAmount)).toFixed(2)})
    await updateUserBalance(socket, Number(user.balance) - Number(data.betAmount));
    console.log(user.balance)
    const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
    const { result, winAmount, updatedBalance, resultNumber } = await calculateCoinFlipResult(
      betObj.betAmount,
      betObj.betOn,
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
    const responsePayload = formatGameResponse(data.betOn, winAmount, updatedBalance, resultNumber);
    const betDataDb = buildBetDataDb(Number(data.betAmount), Number(data.betOn), winAmount );
    await handleBetResult(result, winAmount, betObj.creditTxnId, betDataDb, betObj, debitObj, socket, resultNumber, user.token, matchId, debitData.msg, user);
    cashOutArray = cashOutArray.filter(item => !item.includes(userCashOutKey));
    if(winAmount>0){
      console.log(JSON.stringify(responsePayload))
      emitResult(socket,EVENT_TYPES.win, responsePayload);
    }
    else{
      emitResult(socket,EVENT_TYPES.lose, responsePayload);

    }
    const redisClient = getRedisClient()
    await redisClient.del(redisKey);

    void logInfo(`[END] Spin handled - MatchID: ${matchId}, UserID: ${user.userId}`);
  } catch (err) {
    console.log(err,'errrrrrrr')
    void logError('Arrow Game Error', {
      message: (err as Error).message,
      stack: (err as Error).stack,
      socketId: socket.id
    });

    void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: (err as Error) })
  }
}
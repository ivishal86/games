import { BetPayload } from "../../interface/headAndTails.interface";
import { emitError, emitSocketMessage } from "../../routes/event.routes";
import { createDebitObject, postBetTxn, updateUserBalance, emitResult } from "../../utilities/common";
import { handleBetResult, saveInitialBetToDB, cacheBetToRedis, getBetRedisKey, buildBetData, getUserFromRedis, buildBetDataDb, calculateCoinFlipResult, formatGameResponse, validateBetData, userDashboardHistory } from "../../utilities/helper";
import { logSocket, logInfo, logError } from "../../utilities/logger";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { getRedisClient, incrementCounter } from "../../utilities/redis-connecton";
import { BetRequest } from "../../interface";
import { EVENT_TYPES } from "../../socket/events";
import { sendToQueue } from "../../utilities/amqp";

let cashOutArray: string[] = [];
export async function placeBet(socket: Socket, io: Server, data: BetPayload): Promise<void> {
  try {
    void logSocket('Arrow throw initiated', { socketId: socket.id, payload: data });
    const token = socket?.handshake.query.token
    const gameId = Number(socket.data.userInfo.gameId);
    if (! await validateBetData(socket, data)) return;

    const matchId = uuidv7();
    const user = await getUserFromRedis(socket, matchId);
    if (!user) return;

    const betObj = buildBetData(socket, matchId, Number(data.betAmount), user.gameId);
    const debitObj = createDebitObject(Number(data.betAmount), betObj.debitTxnId, socket, matchId, user.gameId, user.userId);
    const redisKey = getBetRedisKey(socket, matchId);

    await cacheBetToRedis(redisKey, betObj, socket, user);
    const betRequest: BetRequest = {
      webhookData: debitObj,
      token: token as string,
      socketId: socket?.id
    }
    const redisClient = getRedisClient();
    const debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id });
    if (!debitData.status) {
      // const redisClient = getRedisClient()
      await redisClient.del(redisKey);
      emitError(socket, "Bet Cancelled by Upstream Server.")
      return;
    }
    await saveInitialBetToDB(socket, matchId, debitObj, betRequest, betObj);
    await sendToQueue(
      "",
      "post_queue",
      JSON.stringify({
        game_id: Number(gameId),
        betAmount: Number(data.betAmount),
        matchId: matchId,
      })
    );
    let counter = await redisClient.get(`Counter:MegaWheel`)
    console.log(counter, "counter")
    if (!counter) {
      await redisClient.set(`Counter:MegaWheel`, "0");
    }
    void incrementCounter(`Counter:MegaWheel`)
    emitSocketMessage({ socket, action: "betPlaced", message: { balance: (Number(user.balance) - Number(data.betAmount)).toFixed(2), message: "Bet Placed Successfully" } })
    await updateUserBalance(socket, Number(user.balance) - Number(data.betAmount));
    console.log(user.balance)
    const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
    const { result, winAmount, updatedBalance, resultArr } = await calculateCoinFlipResult(
      betObj.betAmount,
      Number(user.balance),
      socket,
      balanceKey,
      gameId
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
    const responsePayload = formatGameResponse(winAmount, updatedBalance, resultArr);
    const betDataDb = buildBetDataDb(Number(data.betAmount), winAmount);
    await handleBetResult(result, winAmount, betObj.creditTxnId, betDataDb, betObj, debitObj, socket, resultArr, user.token, matchId, debitData.msg, user);
    cashOutArray = cashOutArray.filter(item => !item.includes(userCashOutKey));
    if (winAmount > 0) {
      console.log(JSON.stringify(responsePayload))
      emitResult(socket, EVENT_TYPES.win, responsePayload);
    }
    else {
      emitResult(socket, EVENT_TYPES.lose, responsePayload);

    }
    // const key = `mega_wheel_round_history:${user.userId}`;
    // await redisClient.lpush(key, responsePayload.winAmount ? String(responsePayload.winAmount) : "0.00");
    // await redisClient.ltrim(key, 0, 9);
    // const roundData = await redisClient.lrange(key, 0, 9);
    // void emitSocketMessage({ socket, action: EVENT_TYPES.ROUND_HISTORY, message: roundData })
    await redisClient.del(redisKey);
    await userDashboardHistory(socket);
    void logInfo(`[END] Spin handled - MatchID: ${matchId}, UserID: ${user.userId}`);
  } catch (err) {
    console.log(err, 'errrrrrrr')
    void logError('Arrow Game Error', {
      message: (err as Error).message,
      stack: (err as Error).stack,
      socketId: socket.id
    });

    void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: (err as Error) })
  }
}
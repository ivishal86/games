import { BetPayload } from "../../interface/cryptos";
import { emitSocketMessage } from "../../routes/event.routes";
import { createDebitObject, postBetTxn, updateUserBalance } from "../../utilities/common";
import { handleBetResult, saveInitialBetToDB, cacheBetToRedis, buildBetData, getUserFromRedis, buildBetDataDb, formatGameResponse, validateBetData, calculateSlotsResult } from "../../utilities/helper";
import { logSocket, logInfo, logError } from "../../utilities/logger";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { getRedisClient, incrementCounter } from "../../utilities/redis-connecton";
import { BetRequest } from "../../interface";
import config from "../../config/config";
import { EVENT_TYPES } from "../../socket/events";
import { sendToQueue } from "../../utilities/amqp";

let cashOutArray: string[] = [];
export async function placeBet(socket: Socket, io: Server, data: BetPayload): Promise<void> {
  try {
    void logSocket('bet initiated', { socketId: socket.id, payload: data });
    const token = socket?.handshake.query.token;
    const gameId = Number(socket.data.userInfo.gameId);
    if (! await validateBetData(socket, data)) return;

    const matchId = uuidv7();
    const user = await getUserFromRedis(socket, matchId);
    if (!user) return;

    const betObj = buildBetData(socket, matchId, config.multiplier, Number(data.betAmount), user.gameId);
    const debitObj = createDebitObject(Number(data.betAmount), betObj.debitTxnId, socket, matchId, user.gameId, user.userId);
    const redisKey = `BT:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}:${matchId}`

    await cacheBetToRedis(redisKey, betObj, socket, user);
    const betRequest: BetRequest = {
      webhookData: debitObj,
      token: token as string,
      socketId: socket?.id
    }
    const debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id });
    const redisClient = getRedisClient()
    if (!debitData.status) {
      await redisClient.del(redisKey);
      emitSocketMessage({socket,action:EVENT_TYPES.Error,message:"Bet Cancelled by Upstream Server."})
      return;
    }
    await saveInitialBetToDB(socket, matchId, debitObj, betRequest, betObj);

    emitSocketMessage({socket,action:"betPlaced",message:{updatedBalance:(Number(user.balance) - Number(data.betAmount)).toFixed(2)}})
    await sendToQueue(
      "",
      "post_queue",
      JSON.stringify({
        game_id: Number(gameId),
        betAmount: Number(data.betAmount),
        matchId: matchId,
      })
    );
    // count++;
    let counter =await redisClient.get(`Counter:Cryptos`)
    console.log(counter,"counter")
    if (!counter) {
      await redisClient.set(`Counter:Cryptos`,"0");
    }
    void incrementCounter(`Counter:Cryptos`)
    await updateUserBalance(socket, Number(user.balance) - Number(data.betAmount));
    console.log(user.balance)
    const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
    const { result, winAmount, updatedBalance, slots ,multiplier} = await calculateSlotsResult(
      betObj.betAmount,
      Number(user.balance),
      socket,
      balanceKey,
      gameId,
      user.userId
    );

    betObj.result = result;
    betObj.winAmount = winAmount;
    const userCashOutKey = `${debitObj.bet_id}:${matchId}`
    const findUserCashout = cashOutArray.find((id) => id === userCashOutKey);
    if (findUserCashout) {
      void emitSocketMessage({socket,action:EVENT_TYPES.Error,message:"bet under process"})
      return;
    }
    cashOutArray.push(userCashOutKey)
    const responsePayload = formatGameResponse(multiplier, winAmount, updatedBalance, slots);
    const betDataDb = buildBetDataDb(Number(data.betAmount), winAmount );
    await handleBetResult(result, winAmount, betObj.creditTxnId, betDataDb, betObj, debitObj, socket, slots, user.token, matchId, debitData.msg, user);
    cashOutArray = cashOutArray.filter(item => !item.includes(userCashOutKey));
    if(winAmount>0){
      console.log(JSON.stringify(responsePayload))
      emitSocketMessage({socket,action:EVENT_TYPES.win,message:{...responsePayload}})
    }
    else{
      emitSocketMessage({socket,action:EVENT_TYPES.win,message:{...responsePayload}})

    }
    await redisClient.del(redisKey);

    void logInfo(`[END] Result Handled - MatchID: ${matchId}, UserID: ${user.userId}`);
    // console.log("RTP:", simulateRTP(1_000_000, 100).toFixed(2) + "%");
  } catch (err) {
    console.log(err,'errrrrrrr')
    void logError('Arrow Game Error', {
      message: (err as Error).message,
      stack: (err as Error).stack,
      socketId: socket.id
    });

    void emitSocketMessage({socket, action:EVENT_TYPES.Error,message:err})
  }
}
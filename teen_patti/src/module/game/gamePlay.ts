import { BetPayload, Bets, Card, GameResult, ResultDb } from "../../interface/teenPatti.interface";
import { emitSocketMessage } from "../../routes/event.routes";
import { createDebitObject, postBetTxn, updateUserBalance } from "../../utilities/common";
import { handleBetResult, saveInitialBetToDB, cacheBetToRedis, getBetRedisKey, buildBetData, getUserFromRedis, buildBetDataDb, formatGameResponse, calculateResult, userDashboardHistory, dealCards } from "../../utilities/helper";
import { logSocket, logInfo, logError } from "../../utilities/logger";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { getRedisClient, incrementCounter } from "../../utilities/redis-connecton";
import { BetRequest } from "../../interface";
import config from "../../config/config";
import { EVENT_TYPES, SOCKET_EVENTS } from "../../socket/events";
import { ResultEnum } from "../../enum/result.enum";
import { sendToQueue } from "../../utilities/amqp";

export const playerCards: Card[] = []
export const dealerCards: Card[] = []
let cashOutArray: string[] = [];
export async function placeBet(socket: Socket, io: Server, data: BetPayload): Promise<void> {
  try {
    // console.log(data,"<-------data")
    void logSocket('Teen Patti bet initiated', { socketId: socket.id, payload: data });
    const token = socket?.handshake.query.token
    const gameId = Number(socket.data.userInfo.gameId);
    // if (!validateBetData(socket, data)) return;

    const matchId = uuidv7();
    const user = await getUserFromRedis(socket, matchId);
    if (!user) return;
    // console.log(data,"<------bet  data")
    const totalBetAmount = data.bets.reduce((sum, bet) => sum + Number(bet.amount), 0);
    if (totalBetAmount > Number(user.balance)) {
      // emitValidationError(socket, 'Insufficient balance for total bet.');
      void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: 'Insufficient balance for total bet.' })
      return;
    }

    const bets: Bets = {
      bets: data.bets.map(bet => ({
        betOn: bet.betOn as 'player' | 'dealer' | 'split' | `${'player' | 'dealer'} ${'pair' | 'flush' | 'straight' | '3 of a kind' | 'straight flush'}`,
        amount: Number(bet.amount)
      }))
    };
    const betTypeMap: { [key: number]: string } = {
      0: 'dealer',
      1: 'player',
      2: 'split',
      3: 'dealer pair',
      4: 'dealer flush',
      5: 'dealer straight',
      6: 'dealer three_of_a_kind',
      7: 'dealer straight_flush',
      8: 'player pair',
      9: 'player flush',
      10: 'player straight',
      11: 'player three_of_a_kind',
      12: 'player straight_flush'
    };
    const reverseBetTypeMap = Object.fromEntries(
      Object.entries(betTypeMap).map(([key, value]) => [value, Number(key)])
    );
    const betDetail = {
      bets: data.bets.map(bet => ({
        // Replace string with numeric code
        betOn: reverseBetTypeMap[bet.betOn],
        amount: Number(bet.amount)
      }))
    };

    // console.log(bets, "<-------bets")
    const betObj = buildBetData(socket, matchId, config.multiplier, totalBetAmount, user.gameId);
    // console.log(betObj, "betObj")
    const debitObj = createDebitObject(totalBetAmount, betObj.debitTxnId, socket, matchId, user.gameId, user.userId);
    const redisKey = getBetRedisKey(socket, matchId);

    await cacheBetToRedis(redisKey, betObj, socket, user);
    const betRequest: BetRequest = {
      webhookData: debitObj,
      token: token as string,
      socketId: socket?.id
    }

    const redisClient = getRedisClient();
    const debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id }, socket);
    await redisClient.hset(
      `user:${user.userId}:TeenPattiChampion:GameState`,
      "betDetail",
      JSON.stringify(betDetail.bets),
    );
    if (!debitData.status) {
      await redisClient.del(redisKey);
      // emitError(socket, "Bet Cancelled by Upstream Server.")
      void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "Bet Cancelled by Upstream Server." })
      return;
    }
    await saveInitialBetToDB(socket, matchId, debitObj, betRequest, betObj);
    await sendToQueue(
      "",
      "post_queue",
      JSON.stringify({
        game_id: Number(gameId),
        betAmount: Number(totalBetAmount),
        matchId: matchId,
      })
    );
       let counter =await redisClient.get(`Counter:TeenPattiChampion`)
    console.log(counter,"counter")
    if (!counter) {
      await redisClient.set(`Counter:TeenPattiChampion`,"0");
    }
    void incrementCounter(`Counter:TeenPattiChampion`)
    void emitSocketMessage({ socket, action: EVENT_TYPES.betPlaced, message: { balance: (Number(user.balance) - totalBetAmount).toFixed(2), message: "Bet placed Successfully" } })
    await updateUserBalance(socket, Number(user.balance) - totalBetAmount);
    console.log(user.balance)
    //teen patti game
    let { playerHand, dealerHand } =await dealCards(gameId,socket,data);
    playerHand.sort((a, b) => a.rank - b.rank);
    dealerHand.sort((a, b) => a.rank - b.rank);
    const cardSequence = [
      { card: dealerHand[0], target: 'dealer', index: 1 },
      { card: playerHand[0], target: 'player', index: 1 },
      { card: dealerHand[1], target: 'dealer', index: 2 },
      { card: playerHand[1], target: 'player', index: 2 },
      { card: dealerHand[2], target: 'dealer', index: 3 },
      { card: playerHand[2], target: 'player', index: 3 }
    ];

    for (let i = 0; i < cardSequence.length; i++) {
      const { card, target, index } = cardSequence[i];
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (target === "dealer") dealerCards.push(card)
      if (target === "player") playerCards.push(card)
      await redisClient.hset(
        `user:${user.userId}:TeenPattiChampion:GameState`,
        "dealerCards",
        JSON.stringify(dealerCards),
        "playerCards",
        JSON.stringify(playerCards)
      );
      let socketId = await redisClient.hget(`user:${user.userId}:${user.operatorId}`, 'socket');
      // let socketId = socket.data.userInfo.
      // if (socketId) {
      //   io.to(socketId).emit(EVENT_TYPES.win, responsePayload);
      // }
      if (socketId) {

        io.to(socketId).emit(SOCKET_EVENTS.MESSAGE, {
          action: EVENT_TYPES.cardDealt,
          message: {
            card: { suit: card.suit, rank: card.rank },
            target,
            index
          }
        });
      }
    }

    const gameResult: GameResult = calculateResult(bets, playerHand, dealerHand);
    // console.log("game result-------->",gameResult)
    const winAmount = gameResult.payouts.reduce((sum, payout) => sum + payout.payout, 0);
    const updatedBalance = Number(user.balance) - totalBetAmount + winAmount;
    console.log(updatedBalance, "<---------------updatedbalance")
    const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
    // const redisClient = getRedisClient()
    await redisClient.hset(balanceKey, { balance: String(updatedBalance) });
    void updateUserBalance(socket, updatedBalance);
    betObj.result = winAmount > 0 ? 'win' : 'lose';
    betObj.winAmount = winAmount;
    betObj.betAmount = totalBetAmount;
    const userCashOutKey = `${debitObj.bet_id}:${matchId}`
    const findUserCashout = cashOutArray.find((id) => id === userCashOutKey);
    if (findUserCashout) {
      // emitError(socket, "bet under process");
      void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "bet under process" })
      return;
    }
    // let result: ResultEnum = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;
    cashOutArray.push(userCashOutKey)
    // console.log("<-----------game result",gameResult)
    const responsePayload = formatGameResponse(
      winAmount,
      updatedBalance,
      gameResult.mainResult,
      gameResult.playerHand,
      gameResult.dealerHand
    );
    const betDataDb = buildBetDataDb(bets, gameResult);
    console.log(betDataDb, "<-------------bet dat")
    const resultDb: ResultDb = {
      dealerHand,
      playerHand,
      result: gameResult.mainResult
    }
    // console.log(betDataDb, "<---bet data")
    await handleBetResult(
      winAmount > 0 ? ResultEnum.win : ResultEnum.lose,
      winAmount,
      betObj.creditTxnId,
      betDataDb,
      betObj,
      debitObj,
      socket,
      resultDb,
      user.token,
      matchId,
      debitData.msg,
      user
    );
    cashOutArray = cashOutArray.filter(item => !item.includes(userCashOutKey));
    if (winAmount > 0) {
      // emitResult(io, EVENT_TYPES.win, responsePayload);
      let socketId = await redisClient.hget(`user:${user.userId}:${user.operatorId}`, 'socket');
      if (socketId) {
        io.to(socketId).emit(SOCKET_EVENTS.MESSAGE, { action: EVENT_TYPES.win, message: responsePayload });
      }
    } else {
      // emitResult(io, EVENT_TYPES.lose, responsePayload);
      let socketId = await redisClient.hget(`user:${user.userId}:${user.operatorId}`, 'socket');
      if (socketId) {
        io.to(socketId).emit(SOCKET_EVENTS.MESSAGE, { action: EVENT_TYPES.lose, message: responsePayload });
      }
      // io.emit( EVENT_TYPES.lose, responsePayload) 
    }
    let socketId = await redisClient.hget(`user:${user.userId}:${user.operatorId}`, 'socket');
    if (socketId) {
      // io.to(socketId).emit(SOCKET_EVENTS.MESSAGE, { action: EVENT_TYPES.ROUND_HISTORY, message: roundData });
       await userDashboardHistory(socket,io,socketId);
    }
    playerCards.length = 0
    dealerCards.length = 0
    await redisClient.del(`user:${user.userId}:TeenPattiChampion:GameState`)
    await redisClient.del(redisKey);

    void logInfo(`[END] Spin handled - MatchID: ${matchId}, UserID: ${user.userId}`);
  } catch (err) {
    console.log(err, 'errrrrrrr')
    void logError('Teen Patti Error', {
      message: (err as Error).message,
      stack: (err as Error).stack,
      socketId: socket.id
    });

    void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: (err as Error) })
  }
}

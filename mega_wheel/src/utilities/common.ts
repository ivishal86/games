import axios from 'axios';
import config from '../config/config';
import { DebitObj, DebitData, CreditObj, User, PostBetTxnData } from '../interface';
import { logInfo, logError, logRedis, logCashout, logBet, logThirtParty, logFailedThirtParty } from '../utilities/logger';
import { Server, Socket } from 'socket.io';
import { emitSocketMessage } from '../routes/event.routes';
import { EVENT_TYPES } from '../socket/events';
import { sendToQueue } from './amqp';
import { ArrowGameResponse } from '../interface/headAndTails.interface';
import { getRedisClient } from './redis-connecton';

export async function postBetTxn(data: PostBetTxnData): Promise<DebitData> {
  const { webhookData, token, socketId } = data;
  console.log(webhookData,"web hook--------------")
  try {
    const response = await axios.post(
      `${config.SERVICE_BASE_URL}/service/operator/user/balance/v2`,
      { ...webhookData, socketId },
      {
        headers: {
          token,
          'Content-Type': 'application/json',
        },
      }
    );
    void logInfo('[SUCCESS] Debit transaction created', {
      txnId: webhookData.txn_id,
      userId: webhookData.user_id,
      response: response.data,
    });

    return response.data;
  } catch (error: any) {
    console.log("debit error:",error.response?.data)
    console.log("debit error:",error.response?.data?.msg)
    void logError('Unhandled error posting debit transaction', {
      txnId: webhookData.txn_id,
      error: error.response?.data?.msg,
    });
    // throw error.response?.data?.msg;
    return {status:false,msg:"Bet cancelled by upstream"}
  }
}

const DECIMAL_PLACES = 2;
const DEBIT_TXN_TYPE = 0;
const CREDIT_TXN_TYPE = 1;


export async function updateUserBalance(socket: Socket, newBalance: number): Promise<void> {
  const balanceKey = `user:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}`;
  const formattedBalance = newBalance.toFixed(DECIMAL_PLACES);
  const redisClient = getRedisClient()
  await redisClient.hset(balanceKey, 'balance', formattedBalance);

  void logInfo(`Balance updated - UserID: ${socket.data.userInfo.user_id}, NewBalance: ${formattedBalance}`);
  void logRedis('Redis balance update', {
    userId: socket.data.userInfo.user_id,
    operatorId: socket.data.userInfo.operatorId,
    balanceKey,
    newBalance: formattedBalance,
  });
}

export function createDebitObject(betAmount: number, debitTxnId: string, socket: Socket, matchId: string, gameId: string, userId: string): DebitObj {
  return {
    amount: betAmount.toFixed(DECIMAL_PLACES),
    txn_id: debitTxnId,
    ip: socket.handshake.address || 'unknown',
    game_id: Number(gameId),
    user_id:decodeURIComponent(userId),
    description: `${betAmount.toFixed(DECIMAL_PLACES)} Debited for Mega Wheel Game for Round Id ${matchId}`,
    bet_id: `BT:${matchId}:${socket.data.userInfo.operatorId}:${socket.data.userInfo.user_id}`,
    txn_type: DEBIT_TXN_TYPE,
  };
}

export function createCreditObject(winAmount: number, creditTxnId: string, socket: Socket, matchId: string, debitTxnId: string): CreditObj {
  return {
    amount: Number(winAmount.toFixed(DECIMAL_PLACES)),
    txn_id: creditTxnId,
    ip: socket.handshake.address || 'unknown',
    game_id: socket.data.userInfo.gameId,
    user_id: decodeURIComponent(socket.data.userInfo.user_id),
    txn_ref_id: debitTxnId,
    description: `${winAmount.toFixed(DECIMAL_PLACES)} Credited for Mega Wheel Game for Round Id ${matchId}`,
    txn_type: CREDIT_TXN_TYPE,
  };
}

export async function processWinTransaction(creditObj: CreditObj, socket: Socket, token: string, matchId: string): Promise<void> {

  //get redis key
  const redisKey = `BT:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}:${matchId}`;
  //add creditobj in redis
  const redisClient = getRedisClient()
  await redisClient.hset(redisKey, 'winAmount', String(creditObj.amount))
  await redisClient.hset(redisKey, 'creditTxnId', String(creditObj.txn_id))
  await sendToQueue('', 'games_cashout', JSON.stringify({ ...creditObj, operatorId: socket.data.userInfo.operatorId, token }));
  // void logInfo(`Credit transaction queued - creditData: ${creditObj} , operatorId: ${socket.data.userInfo.operatorId} , token: ${token}`);
  void logCashout(`Credit transaction ${JSON.stringify(creditObj)}`)
  console.log(creditObj.game_id,creditObj.amount, matchId,"<-------")
  await sendToQueue(
      "",
      "put_queue",
      JSON.stringify({
        game_id: Number(creditObj.game_id),
        winAmount: creditObj.amount,
        matchId: matchId,
      })
    );
}

// export async function saveGameHistory(socket: Socket, debitObj: DebitObj, matchId: string, betData: BetObj, debitData: DebitData, debitTxnId: string, creditObj: CreditObj | null, result: ResultEnum, creditTxnId: string | null, winAmount: number): Promise<void> {
//   await insertBet({
//     userId: decodeURIComponent(socket.data.userInfo.user_id),
//     betId: debitObj.bet_id,
//     matchId,
//     operatorId: socket.data.userInfo.operatorId,
//     betAmount: betData.betAmount,
//     betData,
//     betStatus: 'completed',
//     betRequest: debitObj,
//     BetResponse: debitData.msg,
//     betTxnId: debitTxnId,
//     isDeclared: true,
//     result: creditObj as object,
//     resultStatus: result,
//     resultTxnId: creditTxnId ?? '',
//     winAmount,
//   });

//   void logInfo(`Game history saved - MatchID: ${matchId}, Result: ${result}, WinAmount: ${winAmount}`);
// }

export function emitResult(socket: Socket,event:keyof typeof EVENT_TYPES, response: ArrowGameResponse): void {
  void logBet("bet result emitted", { data: response })
  emitSocketMessage({
    socket,
    action: event,
    message: response,
  })
}
export async function getUserFromApi(token: string): Promise<User> {
  try {
    const response = await axios.get(`${config.SERVICE_BASE_URL}/service/user/detail`, {
      headers: { token },
    });

    // ✅ Validate API response
    if (response.data && response.data.status && response.data.user) {
      return response.data.user;
    } else {
      throw new Error('Invalid user data received from server');
    }
  } catch (error: any) {
    console.error(
      'Error fetching user details from API:',
      error.response?.data?.msg || error.message
    );

    // ✅ Throw meaningful error message
    throw new Error(
      error.response?.data?.msg || 'Failed to fetch user details from API'
    );
  }
}
export async function disconnectPreviousSocket(
  userId: string,
  operatorId: string,
  io: Server
): Promise<void> {
  const redisKey = `user:${userId}:${operatorId}`;
  const redisClient = getRedisClient()
  const previousSocketId = await redisClient.hget(redisKey, 'socket');

  if (previousSocketId && typeof previousSocketId === 'string') {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket && previousSocket.connected) {
      emitSocketMessage({
        socket: previousSocket,
        action: EVENT_TYPES.anotherwindow,
        message: 'User is Connected Using Another Window.',
      });
      previousSocket.disconnect();
    }
  }
}

export const rollBackTransaction = async (data: any) => {
  const { txn_id, betAmount, userId, matchId } = data
  const clientServerOptions = {
    method: "GET",
    url: `${config.SERVICE_BASE_URL}/service/txn/rollback/${txn_id}`,
    timeout: 5000,
  };

  try {
    const result = await axios(clientServerOptions);
    void logThirtParty(
      JSON.stringify({
        req: `Debit Transaction ID:- ${txn_id} ,userId:- ${userId}, matchId:- ${matchId}`,
        res: result?.data
      })
    );

    return {
      response: result.data,
      status: result.status,
    };
  } catch (err) {
    // const response = err.response ? err.response.data : "Something went wrong";
    const response = parseError(err);
    void logFailedThirtParty(
      JSON.stringify({ req: { txn_id, betAmount, userId, matchId }, res: response })
    );

    return {
      response
    };
  }
};

export const gameDetails = async () => {
  try {
    const data = await axios.get(
      `${config.SERVICE_BASE_URL}/service/game/detail?rd_url=${config.BACKEND_URL}`,
    );
    const gameData = data.data;
    void logInfo(`Game Data recieved:${JSON.stringify(gameData)}`)
    return gameData;
  } catch (err) {
    console.error(err)
    void logError(`${err}`);
    return false;
  }
};

export function parseError(err: unknown): string | object {
  if (typeof err === 'object' && err !== null) {
    const maybeAxiosErr = err as { response?: { data?: unknown } };

    if (maybeAxiosErr.response?.data) {
      return maybeAxiosErr.response.data;
    }

    if (err instanceof Error) {
      return err.message;
    }

    return JSON.stringify(err);
  }

  return 'Something went wrong';
}

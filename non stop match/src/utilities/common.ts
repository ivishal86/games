import axios from "axios";
import { User } from "../interface/user.interface";
import config from "../config/config";
import { BetData, BetObj, CreditObj, DebitData, DebitObj, PostBetTxnData, ResultRequest } from "../interface/common";
import { Server, Socket } from "socket.io";
import { sendToQueue } from "./amqp";
import { logCashout, logError, logFailedThirtParty, logInfo, logRedis, logThirtParty } from "./logger";
import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from "../enum/common";
import { redisClient } from "./redis-connecton";
import { updateBetResult } from "./db-queries";

type EmitTarget = Socket | { io: Server; room: string };

export async function getUserFromApi(token: string): Promise<User> {
  try {
    const response = await axios.get(`${config.SERVICE_BASE_URL}/service/user/detail`, {
      headers: { token },
    });
    if (response.data && response.data.status && response.data.user) {
      return response.data.user; // Return user object
    } else {
      throw new Error('Invalid user data from API');
    }
  } catch (error) {
    console.error('Error fetching user details from API:');
    throw error;
  }
}

export async function postBetTxn(data: PostBetTxnData): Promise<DebitData> {
  const { webhookData, token, socketId } = data;

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
      // response: response.data,
    });
    return response.data;
  } catch (error: unknown) {
    void logError('Unhandled error posting debit transaction', {
      txnId: webhookData.txn_id,
      error,
    });
    console.log("debit api error",error)
    throw new Error("Bet cancelled by Upstream.");
  }
}

export async function processWinTransaction(creditObj: CreditObj, token: string, matchId: string, socket?: Socket): Promise<void> {

  //get redis key
  const redisKey = `BT:${socket?.data.userInfo.user_id}:${socket?.data.userInfo.operatorId}:${matchId}`;
  //add creditobj in redis
  await redisClient.hset(redisKey, 'winAmount', String(creditObj.amount))
  await redisClient.hset(redisKey, 'creditTxnId', String(creditObj.txn_id))
  await sendToQueue('', 'games_cashout', JSON.stringify({ ...creditObj, operatorId: socket?.data.userInfo.operatorId }));
  void logInfo(`Credit transaction queued - creditData: ${creditObj} , operatorId: ${socket?.data.userInfo.operatorId} , token: ${token}`);
  void logCashout(`Credit transaction ${JSON.stringify(creditObj)}`)
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
export function createDebitObject(
  betAmount: number,
  debitTxnId: string,
  socket: Socket,
  matchId: string,
  gameId: string,
  userId: string
): DebitObj {
  const operatorId = socket.data.userInfo.operatorId;

  return {
    amount: betAmount.toFixed(2),
    txn_id: debitTxnId,
    ip: socket.handshake.address || 'unknown',
    game_id: Number(gameId),
    user_id: userId,
    description: `${betAmount.toFixed(2)} Debited for Non Stop Match Game for Round Id ${matchId}`,
    bet_id: `BT:${matchId}:${operatorId}:${userId}`,
    txn_type: 0,
  };
}

export async function handleBetResult(
  resultEnum: ResultEnum,
  winAmount: number,
  creditTxnId: string | null,
  betData: BetData[],
  betObj: BetObj,
  debitObj: DebitObj,
  socket: Socket,
  result: string,
  token: string,
  matchId: string,
  msg: string,
  user: User
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
      betTxnId:debitObj.txn_id,
      userId:user.user_id,
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
      winAmount,
    },'win');

    await processWinTransaction(creditObj, token, matchId, socket);
  } else {
    await updateBetResult({
      betId: debitObj.bet_id,
      betTxnId:debitObj.txn_id,
      userId:user.user_id,
      matchId,
      betData,
      betObj,
      result,
      betResponse: msg,
      betStatus: 'success',
      isDeclared: true,
    },'lose');
  }

}

export function createCreditObject(winAmount: number, creditTxnId: string, socket: Socket, matchId: string, debitTxnId: string): CreditObj {
  return {
    amount: Number(winAmount.toFixed(2)),
    txn_id: creditTxnId,
    ip: socket.handshake.address || 'unknown',
    game_id: socket.data.userInfo.gameId,
    user_id: decodeURIComponent(socket.data.userInfo.user_id),
    txn_ref_id: debitTxnId,
    description: `${winAmount.toFixed(2)} Credited for Non Stop Match Game for Round Id ${matchId}`,
    txn_type: 1,
  };
}
export async function disconnectPreviousSocket(
  userId: string,
  operatorId: string,
  io: Server
): Promise<void> {
  const redisKey = `user:${userId}:${operatorId}`;
  const previousSocketId = await redisClient.hget(redisKey, 'socket');

  if (previousSocketId && typeof previousSocketId === 'string') {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket && previousSocket.connected) {
      emitMessage(
        previousSocket,
        "anotherwindow",
        { message: 'user is connected using another window.' },
      );
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
    const gameData = data.data
    console.log(JSON.stringify(gameData))
    return gameData;
  } catch (err) {
    console.error(err)
    // errorLogger.error(err);
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
export const fetchAndCacheUser = async (token: string, socket: Socket, io: Server, gameId: string): Promise<User> => {
  try {
    void logInfo('Fetching user from external API', {
      token,
      socketId: socket.id,
    });

    const user = await getUserFromApi(token);
    user.gameId = gameId;
    await disconnectPreviousSocket(user.user_id, user.operatorId, io);
    user.user_id = encodeURIComponent(user.user_id);

    const redisKey = `user:${user.user_id}:${user.operatorId}`;
    const redisData = {
      userId: user.user_id,
      name: user.name,
      balance: user.balance,
      operatorId: user.operatorId,
      token,
      socket: socket.id,
      gameId,
    };
    await redisClient.hset(redisKey, redisData);
    await redisClient.expire(redisKey, 3600);

    socket.data["userInfo"] = user;

    void logRedis('User cached in Redis', {
      key: redisKey,
      data: redisData,
    });

    void logInfo('User cache saved in Redis', {
      userId: user.user_id,
      socketId: socket.id,
    });

    return user;
  } catch (error) {
    void logError('Error fetching or caching user', {
      error: (error as Error).message,
      stack: (error as Error).stack,
      token,
      socketId: socket.id,
    });
    throw new Error('Failed to fetch user');
  }
};

export function emitMessage(
  target: EmitTarget,
  type: string,
  data: Record<string, unknown>
): void {
  const payload = { type, data };

  if ('emit' in target) {
    // target is a Socket instance
    target.emit('message', payload);
  } else {
    // target is room-based emission
    target.io.to(target.room).emit('message', payload);
  }
}
import { emitError, emitSocketMessage } from "../../routes/event.routes";
import { createCreditObject, createDebitObject, DEBIT_TXN_TYPE, postBetTxn } from "../../utilities/common";
import { handleBetResult, saveInitialBetToDB, getBetRedisKey, buildBetData, getUserFromRedis, buildBetDataDb, loadState, rebuildAllowed, saveState, resetState, deleteState, parseCsvInts, doBet, cacheBetToRedis, getUserInfo, buildResultDb } from "../../utilities/helper";
import { Server, Socket } from "socket.io";
import { v7 as uuidv7 } from 'uuid';
import { createRedisClient, getRedisClient } from "../../utilities/redis-connection";
import { BetObj, BetRequest, DebitObj } from "../../interface";
import config from "../../config/config";
import { ResultEnum } from "../../enum/result.enum";
import { EVENT_TYPES } from "../../socket/events";

export const GAME_KEY = (userId: string) => `octoberPub:gameState:${userId}`;
export const USER_KEY = (uid: string, op: string) => `user:${uid}:${op}`;
let matchId: string = "";
const betObjects: Record<string, Record<number, BetObj>> = {};


async function debit(
  socket: Socket,
  userId: string,
  operatorId: string,
  amount: number,
  glassId: number
) {
  const redisClient = getRedisClient();
  const key = USER_KEY(userId, operatorId);
  const token = socket?.handshake.query.token
  const bal = Number((await redisClient.hget(key, "balance")) || 0);
  if (bal < amount) throw new Error("Insufficient balance");

  const newBal = bal - amount;
  await redisClient.hset(key, "balance", newBal);

  const user = await getUserFromRedis(socket);
  if (!user) {
    throw Error
  }
  const state = await loadState(userId, operatorId);
  const roundId = `${matchId}_${glassId}`;

  // Create BetObj for this specific glass
  const betObj = buildBetData(socket, matchId, config.multiplier, amount, user.gameId, glassId);

  // Save to in-memory structure
  if (!betObjects[userId]) betObjects[userId] = {};
  betObjects[userId][glassId] = betObj;

  // Create debit object
  const debitObj = createDebitObject(
    amount,
    betObj.debitTxnId,
    socket,
    roundId,
    user.gameId,
    userId
  );

  const redisKey = getBetRedisKey(socket, roundId);
  await cacheBetToRedis(redisKey, betObj, socket, user, roundId);
  const betRequest: BetRequest = {
    webhookData: debitObj,
    token: token as string,
    socketId: socket?.id
  }

  let debitData: any | undefined;
  debitData = await postBetTxn({ webhookData: debitObj, token: user.token, socketId: socket.id }, socket);
  if (!debitData.status) {
    await redisClient.del(redisKey);
    // void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "Bet Cancelled by Upstream Server." })
    return debitData;
  }

  await saveInitialBetToDB(socket, matchId, debitObj, betRequest, betObj, roundId, betObj.debitTxnId, debitData?.msg ?? undefined);

  // return ;
}

async function credit(userId: string, operatorId: string, amount: number) {
  const key = USER_KEY(userId, operatorId);
  const redisClient = createRedisClient();
  const bal = Number((await redisClient.hget(key, "balance")) || 0);

  const newBal = bal + amount;
  await redisClient.hset(key, "balance", newBal);
  return newBal;
}

/* ---------------------------------------------
   START HANDLER
---------------------------------------------- */
export async function startRound({
  socket,
  io,
  payload,
}: {
  socket: Socket;
  io: Server;
  payload: string;
}) {
  const redisClient = getRedisClient();
  const user = await getUserFromRedis(socket);
  if (!user) return emitError(socket, "User not found");

  // parse payload carefully (allow extra colons in future)
  const body = payload.split(":").slice(1).join(":"); // "1,2,3|2:20"
  const [selectedStr, both] = body.split("|");
  if (!both) return emitError(socket, "START format invalid. Expected START:selCsv|betOn:amount");

  const [betOnStr, betAmountStr] = both.split(":");
  const selected = parseCsvInts(selectedStr);
  const betOn = Number(betOnStr);
  const perAmount = Number(betAmountStr);
  if (!selected.length) return emitError(socket, "No cups selected");
  if (!selected.includes(betOn)) return emitError(socket, "betOn must be one of selected");
  if (!perAmount || perAmount <= 0) return emitError(socket, "Invalid per bet amount");

  let state = await resetState(user.userId, user.operatorId);
  matchId = uuidv7();
  const roundId = `${matchId}_${betOn}`;
  // open selected
  const cups = state.cups.map((c) => ({ ...c }));
  selected.forEach((id) => {
    const cup = cups.find((x) => x.id === id);
    if (cup) cup.open = true;
  });

  state = {
    ...state,
    userId: user.userId,
    cups,
    selected,
    allowed: rebuildAllowed(selected, cups),
    perBetAmount: perAmount,
    // totalBetAmount:perAmount
  };

  await saveState(state);

  // Before debiting, reload state to ensure latest
  state = (await loadState(user.userId, user.operatorId))!;

  // Debit perBetAmount
  // try {
  let msg = await debit(socket, user.userId, user.operatorId, perAmount, betOn);
  if (msg && !msg?.status) {
    void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "Bet Cancelled by Upstream Server." })
    return;
  }
  // } catch (e: any) {
  //   return emit(socket, "ERROR", "Debit failed: " + e.message);
  // }

  // Place first bet: re-load state again to be safe
  state = (await loadState(user.userId, user.operatorId))!;
  if (!state) return emitError(socket, "Game state disappeared");

  // Validate betOn is allowed now
  if (!state.allowed.includes(betOn)) {
    return emitError(socket, "Initial bet cup not allowed");
  }

  const { updated, result, deltaWin } = await doBet(state, betOn, perAmount, user);
  const redisKey = getBetRedisKey(socket, roundId);
  const betObj = betObjects[user.userId]?.[betOn];
  console.log(betObj, "betObj<---------------------")
  // console.log(bet)
  if (result == "WIN") {
    await redisClient.hset(redisKey, 'winAmount', String(deltaWin))
    await redisClient.hset(redisKey, 'creditTxnId', String(betObj.creditTxnId))
  } else {
    await redisClient.del(redisKey);
  }
  if (updated.allowed.length === 0) {
    await doWithdraw({ socket, io });
    // return;
  }

  const userInfo = await getUserInfo(user.userId, user.operatorId);

  // emit(socket, "GAME_STATE", {
  //   state: updated,
  //   result,
  //   winAmount: deltaWin,
  // });
  emitSocketMessage({
    socket,
    action: EVENT_TYPES.GAME_STATE,
    message: {
      state: updated,
      result,
      winAmount: deltaWin,
    }
  })
  emitSocketMessage({
    socket,
    action: EVENT_TYPES.info,
    message: { user_id: userInfo.userId, balance: Number(userInfo.balance).toFixed(2), operatorId: userInfo.operatorId },
  })
}

/* ---------------------------------------------
   GP HANDLER
---------------------------------------------- */
export async function placeGPBet({
  socket,
  io,
  cupId,
}: {
  socket: Socket;
  io: Server;
  cupId: number;
}) {
  const user = await getUserFromRedis(socket);
  if (!user) return emitError(socket, "User not found");

  // reload state from redis to get fresh allowed
  let state = await loadState(user.userId, user.operatorId);
  if (!state) return emitError(socket, "Game not started");

  // ensure allowed contains cupId
  if (!state.allowed.includes(cupId)) return emitError(socket, "Cup not allowed");

  // debit perBetAmount — re-check balance
  console.log(state.cups[cupId - 1], state.cups[cupId - 1].alive, 'flagessssss')
  if (state.cups[cupId - 1].fillLevel == 0 && state.cups[cupId - 1].alive) {
    let msg = await debit(socket, user.userId, user.operatorId, state.perBetAmount, cupId);
    if (msg && !msg?.status) {
      void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "Bet Cancelled by Upstream Server." })
      return;
    }
  }

  // re-load state (in case it changed)
  state = (await loadState(user.userId, user.operatorId))!;
  if (!state) return emitError(socket, "Game disappeared");

  if (!state.allowed.includes(cupId)) {
    // refund? we already debited — in real system you'd do safe transaction or Lua script.
    // For safety here, credit back immediately and return error.
    await credit(user.userId, user.operatorId, state.perBetAmount);
    return emitError(socket, "Cup no longer allowed");
  }

  const { updated, result, deltaWin } = await doBet(state, cupId, state.perBetAmount, user);

  //  const allDead = state.cups.every(c => c.alive === false);

  if (updated.allowed.length === 0) {
    // forced cashout but user won 0
    await doWithdraw({ socket, io });
    return;
  }

  const userInfo = await getUserInfo(user.userId, user.operatorId);
  emitSocketMessage({
    socket, action: EVENT_TYPES.GAME_STATE, message: {
      state: updated,
      result,
      winAmount: deltaWin,
    }
  })
  emitSocketMessage({
    socket,
    action: EVENT_TYPES.info,
    message: { user_id: userInfo.userId, balance: Number(userInfo.balance).toFixed(2), operatorId: userInfo.operatorId },
  })
}

export async function doWithdraw({
  socket,
  io,
}: {
  socket: Socket;
  io: Server;
}) {
  const redisClient = getRedisClient();
  const user = await getUserFromRedis(socket);

  if (!user) return emitError(socket, "User not found");

  let state = await loadState(user.userId, user.operatorId);
  if (!state) return emitError(socket, "Game not started");

  const userBetMap = betObjects[user.userId];
  if (!userBetMap) return emitError(socket, "No bet data stored");

  const token = socket?.handshake.query.token;
  const totalWinning = state.win || 0;

  const cups = state.cups;

  // LOOP: Handle each cup in the round
  for (const cup of cups) {
    if (cup.open) {
      const cupId = cup.id;
      let betDataDb = buildBetDataDb(state, cupId);
      let result = buildResultDb(state, cupId)
      const roundId = `${matchId}_${cupId}`;
      const redisKey = getBetRedisKey(socket, roundId);
      // Skip if user did not bet on this cup
      const betObj = userBetMap[cupId];
      if (!betObj) continue;

      // WIN OR LOSE?
      const winAmount = cup.winAmount || 0;
      const resultEnum = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;

      // Build debitObj for DB result update
      const debitObj: DebitObj = {
        amount: betObj.betAmount.toFixed(2),
        txn_id: betObj.debitTxnId,        // debit txn of this glass
        game_id: Number(user.gameId),
        user_id: decodeURIComponent(user.userId),
        ip: socket.handshake.address || "unknown",
        description: `Debited for October Pub Game for Round ${roundId}`,
        bet_id: `BT:${roundId}:${user.operatorId}:${user.userId}`,
        txn_type: DEBIT_TXN_TYPE,
      };

      // Update DB + trigger credit API
      await handleBetResult(
        resultEnum,
        winAmount,
        betObj.creditTxnId, // correct creditTxnId for this cup
        betDataDb,
        betObj,
        debitObj,
        socket,
        result,
        user.token,
        matchId,
        user,
        roundId
      );
      await redisClient.del(redisKey);
    }
  }

  // CREDIT BALANCE to user (total win)
  if (totalWinning > 0) {
    await credit(user.userId, user.operatorId, totalWinning);
  }
  state = await loadState(user.userId, user.operatorId);
  // Clean state
  await resetState(user.userId, user.operatorId);
  await deleteState(user.userId);

  const userInfo = await getUserInfo(user.userId, user.operatorId);

  emitSocketMessage({ socket, action: EVENT_TYPES.CASHOUT, message: { amount: totalWinning } });
  emitSocketMessage({ socket, action: EVENT_TYPES.GAME_STATE, message: { state } })
  emitSocketMessage({
    socket,
    action: EVENT_TYPES.info,
    message: { user_id: userInfo.userId, balance: Number(userInfo.balance).toFixed(2), operatorId: userInfo.operatorId },
  })
}

export async function withdrawCupWin({
  socket,
  io,
  cupId,
}: {
  socket: Socket;
  io: Server;
  cupId: number;
}) {
  const redisClient = getRedisClient();
  const user = await getUserFromRedis(socket);
  // const roundId = `${matchId}_${cupId}`;
  if (!user) return emitError(socket, "User not found");
  const userId = user.userId;

  let state = await loadState(userId, user.operatorId);
  if (!state) return emitError(socket, "Game not started");
  const roundId = `${matchId}_${cupId}`;
  const redisKey = getBetRedisKey(socket, roundId);

  const cups = [...state.cups];
  const idx = cups.findIndex(c => c.id === cupId);
  const cup = cups[idx];

  if (!cup.alive) return emitError(socket, "Cup already stopped");
  if (cup.winAmount <= 0) return emitError(socket, "No winning in this cup");

  const amount = cup.winAmount;

  // Mark cup dead
  cup.alive = false;
  cups[idx] = cup;

  await saveState({ ...state, cups });

  // --- USE IN-MEMORY BET OBJECT ---
  const betObj = betObjects[userId]?.[cupId];
  if (!betObj) {
    return emitError(socket, "Bet object missing for this cup");
  }
  // const debitObj = createDebitObject(state.totalBetAmount, debitTxnObj, socket, roundId, user.gameId, user.userId, cupId);
  // Credit object with correct ref txn
  // Build debitObj for DB update (no debit happening now)
  const debitObj: DebitObj = {
    amount: betObj.betAmount.toFixed(2),
    txn_id: betObj.debitTxnId,
    game_id: Number(user.gameId),
    user_id: decodeURIComponent(user.userId),
    ip: socket.handshake.address,
    txn_type: DEBIT_TXN_TYPE,
    bet_id: `BT:${roundId}:${user.operatorId}:${user.userId}`,
    description: `Debited for OctoberPub Round ${roundId}`
  };
  const creditObj = createCreditObject(
    amount,
    betObj.creditTxnId,
    betObj.debitTxnId,
    socket,
    roundId,
    user.gameId,
    userId
  );

  // Now credit the user
  await credit(userId, user.operatorId, amount);
  const betDataDb = buildBetDataDb(state, cupId);
  // const result = state.cups[cupId -1]
  // await processWinTransaction(creditObj, socket);
  const result = buildResultDb(state, cupId)
  console.log(state.win)
  await handleBetResult(
    amount > 0 ? ResultEnum.win : ResultEnum.lose,
    amount,
    betObj.creditTxnId,
    betDataDb,
    betObj,
    debitObj,
    socket,
    result,
    user.token,
    matchId,
    user,
    roundId
  );

  emitSocketMessage({socket, action:EVENT_TYPES.GLASS_CASHOUT, message:{
    cupId,
    amount,
  }});
  state = await loadState(userId, user.operatorId);
  emitSocketMessage({socket, action:EVENT_TYPES.GAME_STATE, message:{
    state,
  }});
  let userInfo = await getUserInfo(userId, user.operatorId)
  emitSocketMessage({
    socket,
    action: EVENT_TYPES.info,
    message: { user_id: userInfo.userId, balance: Number(userInfo.balance).toFixed(2), operatorId: userInfo.operatorId },
  })
  await redisClient.del(redisKey);
}
// async function autoEndIfNeeded(socket: Socket, io: Server, state: GameState) {
//   if (state.allowed.length === 0) {
//     await doWithdraw({ socket, io })
//     await resetState(state.userId, state.operatorId);
//     const userInfo = await getUserInfo(state.userId, state.operatorId);

//     emit(socket, "END_ROUND_SUCCESS", {
//       reason: "NO_ALIVE_CUPS",
//     });

//     emit(socket, "GAME_STATE", {
//       state: await loadState(state.userId, state.operatorId),
//       userInfo,
//     });

//     return true; // round ended
//   }
//   return false;
// }
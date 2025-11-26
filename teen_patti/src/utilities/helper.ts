import { v7 as uuidv7 } from 'uuid';
import { ResultEnum } from '../enum/result.enum';
import { BetData, BetPayload, Bets, Card, GameResponse, GameResult, HandEvaluation, ResultDb } from '../interface/teenPatti.interface';
import { BetObj, BetRequest, DebitObj, ResultRequest } from '../interface';
import { Server, Socket } from 'socket.io';
import { emitSocketMessage } from '../routes/event.routes';
import { logError } from './logger';
import { createCreditObject, createDeck, processWinTransaction, shuffleDeck } from './common';
import config from '../config/config';
import { getRedisClient, resetCounter, setHashField } from './redis-connecton';
import { getLastRounds, saveBetToDB, updateBetResult } from './db-queries';
import { EVENT_TYPES, SOCKET_EVENTS } from '../socket/events';
import axios from 'axios';

export const DECIMALS = 2;
// Suits and ranks
export const suits: string[] = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
export const ranks: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J, 12=Q, 13=K, 14=A

const SIDE_MULTIPLIERS: { [key: string]: number } = {
  pair: config.PAIR,
  flush: config.FLUSH,
  straight: config.STRAIGHT,
  three_of_a_kind: config.THREE_OF_A_KIND,
  straight_flush: config.STRAIGHT_FLUSH
};

// Hand type constants (higher value = better hand)
export const HAND_TYPES = {
  HIGH_CARD: 1,
  PAIR: 2,
  FLUSH: 3,
  STRAIGHT: 4,
  THREE_OF_A_KIND: 5,
  STRAIGHT_FLUSH: 6
} as const;
export function formatGameResponse(
  // totalBetAmount: number,
  winAmount: number,
  updatedBalance: number,
  result: string,
  playerHand: Card[],
  dealerHand: Card[],

): GameResponse {
  if (winAmount > 0) {
    return {
      // isFinished: true,
      // isWin: winAmount > 0,
      // multiplier: winAmount > 0 ? 1.9 : 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      // betOn,
      dealerHand,
      playerHand,
      winAmount: winAmount.toFixed(DECIMALS),
      result,
      balance: updatedBalance
    };
  } else {
    return {
      // isFinished: true,
      // isWin: winAmount < 0,
      // betAmount: totalBetAmount.toFixed(DECIMALS),
      // betOn,
      dealerHand,
      playerHand,
      winAmount: winAmount.toFixed(DECIMALS),
      result,
      balance: updatedBalance
    }
  }
}

export function validateBetString(socket: Socket, betString: string): BetPayload | undefined {
  // Regex for PB:<bet1>,<bet2>,... where bet is PL-10 or PL-FL-10
  const betPattern = /^PB:((?:\d{1,2}-\d+\.?\d*(?:,\d{1,2}-\d+\.?\d*)*)?)$/;
  if (!betPattern.test(betString)) {
    // emitValidationError(socket, 'Invalid format for place bet. Expected format: PB:PL-10,PL-FL-10');
    //void emitSocketMessage({socket, action:EVENT_TYPES.Error, message:'Invalid format for place bet. Expected format: PB:PL-10,PL-FL-10'})
    throw new Error('Invalid bet string format');
  }

  const [, betsPart = ''] = betString.split(':');
  if (!betsPart) {
    // emitValidationError(socket, 'No bets provided.');
    //void emitSocketMessage({socket, action:EVENT_TYPES.Error, message:"No Bets Provided"})
    throw new Error('No Bets Provided');
  }
  // Mapping of numbers to bet types
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
  const mainBets = new Set([0, 1, 2]); // dealer, player, split
  const dealerSideBets = new Set([3, 4, 5, 6, 7]);
  const playerSideBets = new Set([8, 9, 10, 11, 12]);

  // Track betOn values for duplicates and categories
  const seenBetOn = new Set<string>();
  let totalBetAmount = 0;

  // Track categories: main, player side, dealer side
  const seenCategories = {
    main: false, // Only one main bet (player, dealer, or split)
    playerSide: false, // Only one player side bet
    dealerSide: false // Only one dealer side bet
  };

  const parsedBets: { betOn: string; amount: string }[] = [];

  const bets = betsPart.split(',').map(bet => {
    const [betNumStr, amountStr] = bet.split('-');
    const betNum = Number(betNumStr);
    const amount = Number(amountStr);

    // Validate bet number
    if (!(betNum in betTypeMap)) {
      throw new Error(`Invalid bet type: ${betNum}`);
    }

    // Validate amount
    if (isNaN(amount) || amount < 10) {
      throw new Error(`Bet amount must be at least 10: ${amountStr}`);
    }

    totalBetAmount += amount;
    if (totalBetAmount > 20000) {
      throw new Error('Total bet amount exceeds 20,000');
    }

    // Check duplicates
    if (seenBetOn.has(String(betNum))) {
      throw new Error(`Duplicate bet type: ${betTypeMap[betNum]}`);
    }
    seenBetOn.add(String(betNum));

    // Category restrictions
    if (mainBets.has(betNum)) {
      if (seenCategories.main) throw new Error('Cannot place multiple main bets');
      seenCategories.main = true;
    } else if (playerSideBets.has(betNum)) {
      if (seenCategories.playerSide) throw new Error('Cannot place multiple player side bets');
      seenCategories.playerSide = true;
    } else if (dealerSideBets.has(betNum)) {
      if (seenCategories.dealerSide) throw new Error('Cannot place multiple dealer side bets');
      seenCategories.dealerSide = true;
    }

    parsedBets.push({ betOn: betTypeMap[betNum], amount: amountStr });
    return { betNum, amount };
  });

  if (parsedBets.length === 0) {
    // emitValidationError(socket, 'No valid bets provided.');
    //void emitSocketMessage({socket, action:EVENT_TYPES.Error, message:'No valid bets provided.'})
    throw new Error('No valid bets provided');
  }

  return { bets: parsedBets };
}

export function getGameConfig(): Record<string, object | number> {
  let chip = [10, 50, 100, 500, 1000]
  return {
    minBet: config.bet.MIN_BET,
    maxBet: config.bet.MAX_BET,
    chip,
    multipliers: {
      dealer: config.MAIN_MULTIPLIER,
      player: config.MAIN_MULTIPLIER,
      split: config.SPLIT,
      pair: config.PAIR,
      flush: config.FLUSH,
      straight: config.STRAIGHT,
      threeOfAKind: config.THREE_OF_A_KIND,
      straightFlush: config.STRAIGHT_FLUSH
    }
  };
}

export function calculateAverageMultiplier(betAmount: number, winAmount: number): string {
  try {
    // if (!Array.isArray(betData) || betData.length === 0) return '0';

    // const betAmounts: number[] = betData.map(bet => Number(bet.betAmount));
    // const sum = betAmounts.reduce((acc, val) => acc + val, 0);
    const avg = winAmount / betAmount;
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
    // emitError(socket, 'User data not found');
    void emitSocketMessage({ socket, action: EVENT_TYPES.Error, message: "User data not found" })
    return null;
  }
  return user;
}

export function buildBetData(socket: Socket, matchId: string, multiplier: number, betAmount: number, gameId: string): BetObj {
  return {
    gameId,
    matchId,
    multiplier,
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
  betData: BetData[],
  betObj: BetObj,
  debitObj: DebitObj,
  socket: Socket,
  result: ResultDb,
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
  bets: Bets,
  gameResult: GameResult
): BetData[] {
  const betData: BetData[] = [];
  bets.bets.forEach((bet, index) => {
    const payout = gameResult.payouts[index]?.payout || 0; // Match by index
    betData.push({
      betOn: bet.betOn,
      betAmount: bet.amount,
      payout,
      multiplier: payout / bet.amount
    });
  });
  return betData;
}

// Deal 3 cards to player and 3 to dealer
export const dealCards = async (
  gameId: number,
  socket: Socket,
  betData: BetPayload
): Promise<{ playerHand: Card[]; dealerHand: Card[] }> => {
  const redisClient = getRedisClient();
  const countStr = await redisClient.get(`Counter:TeenPattiChampion`);
  const count = countStr !== null ? Number(countStr) : 0;

  let dealerHand: Card[] = [];
  let playerHand: Card[] = [];

  // Step 1: Create and shuffle a deck
  const deck = shuffleDeck(createDeck());

  // Step 2: Normal deal by default
  dealerHand = deck.slice(0, 3);
  playerHand = deck.slice(3, 6);

  // Step 3: If counter exceeds threshold, check for manipulation
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
        const userBetOnDealer = betData.bets.some(
          (bet: { betOn: string }) => bet.betOn === "dealer"
        );

        if (userBetOnDealer) {
          // User bet on dealer → player should win
          // console.log("🃏 User bet on dealer → player wins (dealer loses)");
          dealerHand = [
            { suit: "Clubs", rank: 2 },
            { suit: "Diamonds", rank: 8 },
            { suit: "Hearts", rank: 9 },
          ];
          playerHand = [
            { suit: "Spades", rank: 10 },
            { suit: "Hearts", rank: 6 },
            { suit: "Diamonds", rank: 2 },
          ];
        } else {
          // User didn't bet on dealer → dealer should win
          // console.log("🃏 User didn't bet on dealer → dealer wins (player loses)");
          dealerHand = [
            { suit: "Clubs", rank: 12 },
            { suit: "Spades", rank:  8},
            { suit: "Hearts", rank: 5 },
          ];
          playerHand = [
            { suit: "Diamonds", rank: 3 },
            { suit: "Hearts", rank: 9 },
            { suit: "Spades", rank: 10 },
          ];
        }
      }
    } else {
      console.log("Normal Teen Patti round");
      await resetCounter(`Counter:TeenPattiChampion`);
    }
  }
  return { playerHand, dealerHand };
};

// Evaluate a single hand and return { type, values } for comparison
export function evaluateHand(hand: Card[]): HandEvaluation {
  const sorted = hand.slice().sort((a, b) => a.rank - b.rank);
  const ranks = sorted.map(card => card.rank);
  const suits = sorted.map(card => card.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(ranks);
  const isThreeOfAKind = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const isPair =
    (ranks[0] === ranks[1] && ranks[1] !== ranks[2]) ||
    (ranks[1] === ranks[2] && ranks[2] !== ranks[0]);

  let type: number = HAND_TYPES.HIGH_CARD;
  // default: descending ranks for high-card comparison
  let values: number[] = ranks.slice().reverse();

  if (isThreeOfAKind) {
    type = HAND_TYPES.THREE_OF_A_KIND;
    // values: three-of-a-kind rank first (descending)
    values = [ranks[1], ranks[1], ranks[1]]; // middle is the trip rank
  } else if (isFlush && isStraight) {
    type = HAND_TYPES.STRAIGHT_FLUSH;
    // For A-2-3 special case, normalize high to Ace
    if (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14) {
      values = [14, 3, 2];
    } else {
      values = ranks.slice().reverse();
    }
  } else if (isStraight) {
    type = HAND_TYPES.STRAIGHT;
    if (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14) {
      values = [14, 3, 2];
    } else {
      values = ranks.slice().reverse();
    }
  } else if (isFlush) {
    type = HAND_TYPES.FLUSH;
    values = ranks.slice().reverse();
  } else if (isPair) {
    type = HAND_TYPES.PAIR;
    // find pair rank and kicker
    let pairRank: number;
    let kicker: number;
    if (ranks[0] === ranks[1]) {
      pairRank = ranks[0];
      kicker = ranks[2];
    } else {
      pairRank = ranks[1]; // ranks[1] === ranks[2]
      kicker = ranks[0];
    }
    // values: compare by pairRank first (higher pair wins), then kicker
    values = [pairRank, kicker, 0];
  }

  return { type, values };
}


// Helper to check if ranks form a straight
export function checkStraight(ranks: number[]): boolean {
  // Normal consecutive
  if (ranks[1] - ranks[0] === 1 && ranks[2] - ranks[1] === 1) return true;
  // A-2-3 special case
  if (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14) return true;
  return false;
}

// Compare two hands: 1 if hand1 > hand2, -1 if hand1 < hand2, 0 if tie
export function compareHands(hand1Eval: HandEvaluation, hand2Eval: HandEvaluation): number {
  if (hand1Eval.type > hand2Eval.type) return 1;
  if (hand1Eval.type < hand2Eval.type) return -1;
  // Same type, compare values descending
  for (let i = 0; i < hand1Eval.values.length; i++) {
    if (hand1Eval.values[i] > hand2Eval.values[i]) return 1;
    if (hand1Eval.values[i] < hand2Eval.values[i]) return -1;
  }
  return 0;
}

// Check if a hand matches a specific condition for side bets
export function checkCondition(handEval: HandEvaluation, condition: string): boolean {
  // console.log(condition,"condition")
  switch (condition.toLowerCase()) {
    case 'pair': return handEval.type === HAND_TYPES.PAIR;
    case 'flush': return handEval.type === HAND_TYPES.FLUSH || handEval.type === HAND_TYPES.STRAIGHT_FLUSH;
    case 'straight': return handEval.type === HAND_TYPES.STRAIGHT;
    case 'straight_flush': return handEval.type === HAND_TYPES.STRAIGHT_FLUSH;
    case 'three_of_a_kind': return handEval.type === HAND_TYPES.THREE_OF_A_KIND;
    default: return false;
  }
}

// Main function to calculate result after dealing
export function calculateResult(bets: Bets, playerHand: Card[], dealerHand: Card[]): GameResult {
  const playerEval = evaluateHand(playerHand);
  const dealerEval = evaluateHand(dealerHand);
  const comparison = compareHands(playerEval, dealerEval);
  let mainResult: 'player' | 'dealer' | 'split' = 'split';
  if (comparison > 0) mainResult = 'player';
  else if (comparison < 0) mainResult = 'dealer';

  const payouts: { betOn: string; payout: number }[] = bets.bets.map(bet => {
    let payout = 0;
    const [target, condition] = bet.betOn.split(' ') as [string, string | undefined];
    if (!condition) {
      // Main bet
      if (bet.betOn === 'player' && mainResult === 'player') {
        payout = bet.amount * config.MAIN_MULTIPLIER;
      } else if (bet.betOn === 'dealer' && mainResult === 'dealer') {
        payout = bet.amount * config.MAIN_MULTIPLIER;
      } else if (bet.betOn === 'split' && mainResult === 'split') {
        payout = bet.amount * config.SPLIT;
      }
    } else {
      // Side bet
      const handEval = target === 'player' ? playerEval : dealerEval;
      if (checkCondition(handEval, condition)) {
        const multiplier = SIDE_MULTIPLIERS[condition.toLowerCase()];
        if (multiplier) {
          payout = bet.amount * multiplier;
        }
      }
    }

    return { betOn: bet.betOn, payout };
  });

  return {
    playerHand,
    dealerHand,
    mainResult,
    payouts,
    playerType: playerEval.type,
    dealerType: dealerEval.type
  };
}


//-----------------userDashboard history event------------------------
export const userDashboardHistory = async (socket: Socket, io: Server, socketId: string) => {
  const userId = socket.data?.userInfo?.user_id;
  if (!userId) {
    console.error("User ID not found in socket data");
    return io.to(socketId).emit("error", "User not authenticated");
  }
  try {
    const historyEntries = await getLastRounds(userId);
    io.to(socketId).emit(SOCKET_EVENTS.MESSAGE, { action: EVENT_TYPES.ROUND_HISTORY, message: historyEntries });
  } catch (error) {
    console.error("Error fetching user history:", error);
    io.to(socketId).emit("error", "Failed to fetch user history");
  }
};

function getHandType(hand: Card[]): string {
  const ranks = hand.map(c => c.rank).sort((a, b) => a - b);
  const uniqueRanks = new Set(ranks);

  const isSequence = ranks[2] - ranks[0] === 2 && uniqueRanks.size === 3;
  const isFlush = hand.every(c => c.suit === hand[0].suit);

  if (uniqueRanks.size === 1) return "three of a kind";
  if (isSequence && isFlush) return "straight flush";
  if(isFlush) return "flush" 
  if (isSequence) return "straight";
  if (uniqueRanks.size === 2) return "pair";
  return "high_card";
}

function evaluateHandnew(hand: Card[]) {
  const type = getHandType(hand);
  const sortedRanks = hand.map(c => c.rank).sort((a, b) => b - a);
  let total: number;

  if (type === "high_card") {
    total = sortedRanks[0] + sortedRanks[1] / 100 + sortedRanks[2] / 10000;
  } else {
    // For non-high-card hands, return sum of ranks
    total = hand.reduce((sum, c) => sum + c.rank, 0);
  }

  return { type, total };
}

export function processHandComparison(playerHand: Card[], dealerHand: Card[]) {
  const playerEval = evaluateHandnew(playerHand);
  const dealerEval = evaluateHandnew(dealerHand);

  if (playerEval.type === "high_card" && dealerEval.type === "high_card") {
    // Same condition → send total numbers

    return {
      dealer_total: dealerEval.total>playerEval.total?dealerEval.type:"low_card",
      player_total: dealerEval.total<playerEval.total?playerEval.type:"low_card",
    };
  } else {
    // Different condition → send totals if high card, otherwise send condition
    return {
      dealer_total:dealerEval.type,
      player_total:playerEval.type ,
    };
  }
}

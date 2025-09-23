import { buildBetData, createDebitObject, emitMessage, handleBetResult, postBetTxn } from '../../utilities/common';
import { ResultEnum } from '../../enum/common';
import { buildBetDataDb, cacheBetToRedis, getBalance, updateBalance, validateArrowGameData } from '../../utilities/helper';
import { Card } from '../../interface/card.interface';
import { logError, logRedis, logBet, logSocket } from '../../utilities/logger';
import { Bet } from '../../interface/bet.interface';
import { saveInitialBetToDB } from '../../utilities/db-queries';
import config from '../../config/config';
import { BetObj, BetRequest, PlaceBetPayload } from '../../interface/common';
import { Server, Socket } from 'socket.io';
import { gameManager } from './lobby';
import { GamePhase } from '../../enum/gamePhase.enum';
import { redisClient } from '../../utilities/redis-connecton';
export type RoundResult = {
    homeCard: Card;
    awayCard: Card;
    result: 'HOME' | 'AWAY' | 'DRAW';
};
const betOnHash: Map<string, string> = new Map();
const roundBets: Map<string, Bet[]> = new Map();
const roundResults: Map<string, RoundResult> = new Map();
let pendingBets: Bet[] = [];
let cashOutArray: string[] = [];

export async function handlePlaceBet(io: Server, socket: Socket, data: PlaceBetPayload): Promise<void> {
    // const betOn=data.betString;
    const user = socket.data.userInfo;
    const userExists = await redisClient.exists(`user:${user.user_id}:${user.operatorId}`);
    if (!userExists) {
        emitMessage(socket, 'error', {
            message: 'User data not found in Redis. Cannot place bet.',
        });
        return;
    }
    if (!validateArrowGameData(socket, data)) return;
    console.log(data)
    const roundId = gameManager.getCurrentRoundId();
    const phase = gameManager.getCurrentPhase();
    betOnHash.set("betOn", data.betString)
    if (phase !== GamePhase.BET_ACCEPTANCE) {
        emitMessage(socket, 'ERROR', { message: 'Bets are only allowed during Bet Acceptance phase' });
        void logError('Attempt to place bet outside BET Acceptance phase', {
            socketId: socket.id,
            userId: user.user_id,
            phase,
        });
        return;
    }
    if (!user || !data.betString || typeof data.betString !== 'string') {
        emitMessage(socket, 'ERROR', { message: 'Invalid bet payload' });
        void logError('Invalid bet payload', {
            socketId: socket.id,
            user: user?.user_id || null,
            data,
        });
        return;
    }

    const betEntries = data.betString.replace(/^PB:/, '').split(',');
    const betsByType: Record<'HOME' | 'AWAY' | 'DRAW', number> = { HOME: 0, AWAY: 0, DRAW: 0 };
    const mapping: Record<string, 'HOME' | 'AWAY' | 'DRAW'> = {
        '1': 'HOME',
        '2': 'AWAY',
        '3': 'DRAW',
    };

    let totalAmount = 0;

    for (const entry of betEntries) {
        const [typeStr, amtStr] = entry.split('-');
        const betType = mapping[typeStr];
        const amount = Number(amtStr);

        if (!betType || isNaN(amount) || amount <= 0) continue;

        betsByType[betType] += amount;
        totalAmount += amount;
    }

    // ✅ Add min/max total bet amount validation
    if (totalAmount < 10 || totalAmount > 20000) {
        emitMessage(socket, 'ERROR', {
            message: 'Total bet amount must be between 10 and 20000',
        });
        void logError('Invalid total bet amount', {
            socketId: socket.id,
            userId: user.user_id,
            totalAmount,
        });
        return;
    }
    // ✅ Add min/max total bet amount validation
    if (totalAmount < 10 || totalAmount > 20000) {
        emitMessage(socket, 'ERROR', {
            message: 'Total bet amount must be between 10 and 20000',
        });
        void logError('Invalid total bet amount', {
            socketId: socket.id,
            userId: user.user_id,
            totalAmount,
        });
        return;
    }
    addPendingBet({
        userId: user.user_id,
        operatorId: user.operatorId,
        gameId: user.gameId,
        socket,
        roundId,
        totalAmount,
        betBreakdown: betsByType,
    });

    emitMessage(socket, 'BET_PLACED', {
        message: "Bet Placed successfully",
        roundId,
        totalAmount,
        betBreakdown: betsByType,
    });

    void logBet('Bet placed successfully', {
        userId: user.user_id,
        socketId: socket.id,
        roundId,
        totalAmount,
        betBreakdown: betsByType,
    });

    void logSocket('BET_PLACED emitted to socket', {
        socketId: socket.id,
        roundId,
        totalAmount,
    });
}


// -- Add a bet to pending queue
export function addPendingBet(bet: Bet): void {
    pendingBets.push(bet);
}

// -- Validate & Store bets (Bet Acceptance Phase)
export async function validateAndStore(roundId: string): Promise<BetObj | undefined> {
    const accepted: Bet[] = [];
    let betObj;
    for (const bet of pendingBets) {
        console.log("bet-=-=-",bet)
        try {
            const user = bet.socket?.data.userInfo;
            const token = bet.socket?.handshake.query.token;
            if (!user || !token) {
                void logError('Skipping bet due to missing user or token', {
                    bet,
                });
                continue;
            }
            betObj = buildBetData(bet.socket, roundId, bet.totalAmount, bet.gameId);
            const debitObj = createDebitObject(bet.totalAmount, betObj.debitTxnId, bet.socket!, roundId, user.gameId, user.user_id);
            const redisBetKey = `BT:${bet.socket.data.userInfo.user_id}:${bet.socket.data.userInfo.operatorId}:${roundId}`;
            await cacheBetToRedis(redisBetKey, betObj, bet.socket, user);
            void logRedis('Cached bet to Redis', {
                redisBetKey,
                userId: user.user_id,
                roundId,
            });
            const betRequest: BetRequest = {
                webhookData: debitObj,
                token: token as string,
                socketId: bet.socket?.id
            }

            //   const matchId = gameManager.getCurrentRoundId();
            const debitRes = await postBetTxn({
                webhookData: debitObj,
                token: token as string,
                socketId: bet.socket?.id
            });
            if (!debitRes.status) {
                await redisClient.del(redisBetKey);
                void logError('Bet debit transaction failed. Bet removed from Redis.', {
                    userId: bet.userId,
                    roundId,
                    reason: debitRes.msg,
                });
                continue;
            }
            await saveInitialBetToDB(bet.socket, roundId, debitObj, betRequest, betObj);
            void logBet('Initial bet saved to DB', {
                userId: user.user_id,
                roundId,
                amount: bet.totalAmount,
            });
            await updateBalance(bet.userId, bet.operatorId, -bet.totalAmount);
            void logRedis('User balance debited in Redis', {
                userId: bet.userId,
                operatorId: bet.operatorId,
                amount: -bet.totalAmount,
            });

            // if (!debitRes?.status) continue;
            bet.debitMsg = debitRes.msg;

            if (!roundBets.has(roundId)) roundBets.set(roundId, []);
            roundBets.get(roundId)!.push({ ...bet, debitObj, betObj });

            accepted.push(bet);

            const redisKey = `user:${bet.userId}:${bet.operatorId}`;
            const balance = await redisClient.hget(redisKey, 'balance');

            emitMessage(bet.socket, 'BET_ACCEPTED',
                {
                    roundId,
                    balance: Number(balance),
                })

            emitMessage(bet.socket, 'info', {
                user:
                {
                    userId: bet.userId,
                    operatorId: bet.operatorId,
                    balance: Number(balance),
                    lastWinAmount: 0
                }
            });
        } catch (err:any) {
            console.error('Validate error:', err);
            void logError('Error validating or storing bet', {
                error: (err as Error).message,
                stack: (err as Error).stack,
                roundId,
                socketId: bet.socket?.id,
                userId: bet.userId,
            });
            void emitMessage(bet.socket,"ERROR", {message:err.message})
        }
    }

    pendingBets = [];
    //     if (!betData) {
    //     throw new Error('No valid bet was processed, betData is undefined');
    //   }

    return betObj;
}


// -- Store result
export function setResult(roundId: string, result: RoundResult): void {
    roundResults.set(roundId, result);
}


// -- Process winnings
export async function processWinners(roundId: string, betObj?: BetObj): Promise<number|void> {
    const result = roundResults.get(roundId);
    const bets = roundBets.get(roundId) || [];
    // let appliedMultiplier = '0';
    if (!result) {
        void logError('Missing result for round during winner processing', { roundId });
        return;
    }
    // console.log("bets--------------------",bets)
    for (const bet of bets) {
        try {

            const socket = bet.socket!;
            const token = socket?.handshake.query.token;
            const user = socket.data.userInfo;
            let winAmount = 0;
            let resultEnum = ResultEnum.lose;
            const userCashOutKey = `${bet.debitObj?.bet_id}:${roundId}`
            const findUserCashout = cashOutArray.find((id) => id === userCashOutKey);
            if (findUserCashout) {
                emitMessage(socket, "cashoutError", { message: "bet under process" });
                return;
            }
            cashOutArray.push(userCashOutKey)
            // if (result.result === 'DRAW') {
            //     if (bet.betBreakdown.DRAW) {
            //         appliedMultiplier = String(config.miltiplier.DRAW);
            //     } else {
            //         appliedMultiplier = String(config.miltiplier.OTHERWITHDRAW);
            //     }
            // } else {
            //     // Result is HOME or AWAY
            //     if (bet.betBreakdown[result.result]) {
            //         appliedMultiplier = String(config.miltiplier.OTHER);
            //     }
            // }

            if (result.result === 'DRAW') {
                // 1. Check if user bet on DRAW
                if (bet.betBreakdown.DRAW) {
                    winAmount += bet.betBreakdown.DRAW * Number(config.multiplier.DRAW);
                }

                // 2. Refund 50% of HOME/AWAY if DRAW was not selected
                if (!bet.betBreakdown.DRAW) {
                    if (bet.betBreakdown.HOME) {
                        winAmount += bet.betBreakdown.HOME * Number(config.multiplier.OTHERWITHDRAW);
                    }
                    if (bet.betBreakdown.AWAY) {
                        winAmount += bet.betBreakdown.AWAY * Number(config.multiplier.OTHERWITHDRAW);
                    }
                }

                resultEnum = winAmount > 0 ? ResultEnum.win : ResultEnum.lose;
            } else {
                // Result is HOME or AWAY
                const winningSide = result.result;
                const betAmountForResult = bet.betBreakdown[winningSide] || 0;

                if (betAmountForResult > 0) {
                    winAmount = betAmountForResult * Number(config.multiplier.OTHER);;
                    resultEnum = ResultEnum.win;
                }
            }

            // 💰 Update user balance
            if (winAmount > 0) {
                await updateBalance(user.user_id, user.operatorId, winAmount);
                void logRedis('Credited win amount to user balance', {
                    userId: user.user_id,
                    operatorId: user.operatorId,
                    winAmount,
                });
            }
            if (bet.betObj) {
                bet.betObj.winAmount = winAmount;
                if (resultEnum == ResultEnum.win) {
                    bet.betObj.result = ResultEnum.win
                }
            }
            const balance = await getBalance(bet.userId, bet.operatorId);
            // const betString = betOnHash.get("betOn")
            // console.log(betString,"betString")
            const betString = bet.betBreakdown;
            console.log(bet.betBreakdown,'breakdown')
            const betDataDb = buildBetDataDb(betString , result.result);
            // 📤 Emit user info with updated balance and win amount
             const winDetails = {
                  result,
                  winAmount: String(winAmount)
                }
            emitMessage(socket,'winDetails', winDetails)
            const userData = {
                userId: bet.userId,
                operatorId: bet.operatorId,
                balance: Number(balance),
                lastWinAmount: winAmount,
                roundId
            }
            emitMessage(socket, 'info', { user: userData });
            console.log(bet.userId,'user win here ---------------------')
            void logSocket('Sent win info to user', {
                socketId: socket.id,
                userId: bet.userId,
                winAmount,
                balance,
                roundId,
            });
            await handleBetResult(
                resultEnum,
                winAmount,
                winAmount > 0 ? betObj!.creditTxnId : null,
                betDataDb,
                bet.betObj!,
                bet.debitObj!,
                socket,
                JSON.stringify(result),
                token as string,
                roundId,
                bet.debitMsg || '',
                user
            );
            void logBet('Handled bet result', {
                userId: user.user_id,
                roundId,
                resultEnum,
                winAmount,
                creditTxnId: winAmount > 0 ? betObj!.creditTxnId : null,
            });
            const redisKey = `BT:${socket.data.userInfo.user_id}:${socket.data.userInfo.operatorId}:${roundId}`;
            await redisClient.del(redisKey);
            cashOutArray = cashOutArray.filter(item => !item.includes(userCashOutKey));
            void logRedis('Deleted bet data from Redis', { redisKey });
            // return winAmount;
        } catch (error) {
            void logError('Error processing individual bet result', {
                error: (error as Error).message,
                roundId,
                userId: bet.userId,
                socketId: bet.socket?.id,
            });
        }
    }

    // 🧹 Cleanup
    roundBets.delete(roundId);
    roundResults.delete(roundId);
}

import { Server } from 'socket.io';
import { Card, ResultDraw } from '../../interface/card.interface';
import config from '../../config/config';
import { logError, logInfo, logRedis, logSocket } from '../../utilities/logger';
import createDeckManager from './deckManager';
import { generateUUIDv7 } from '../../utilities/helper';
import { processWinners, setResult, validateAndStore } from './game';
import { GamePhase } from '../../enum/gamePhase.enum';
import { emitMessage } from '../../utilities/common';
import { BetObj } from '../../interface/common';
import { redisClient } from '../../utilities/redis-connecton';

let currentPhase: GamePhase = GamePhase.BET;
let currentRoundId = '';
let phaseStartTimestamp = Date.now();
const gameRoom = String(config.ROOMID);
let ioRef: Server;
let deckManager: ReturnType<typeof createDeckManager>;
let countdownInterval: NodeJS.Timeout | null = null;
export let deckManagers = new Map<string, ReturnType<typeof createDeckManager>>();
function startPhaseCountdownBroadcast(result?: ResultDraw): void {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
  }

  countdownInterval = setInterval(() => {
    const now = Date.now();
    const duration = getPhaseDuration(currentPhase) * 1000;
    const elapsed = now - phaseStartTimestamp;
    const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
    emitMessage({ io: ioRef, room: config.ROOMID as string, }, 'PHASE_TIMER_UPDATE', {
      phase: currentPhase,
      remainingTime: remaining,
      homeCard: result?.homeCard,
      awayCard: result?.awayCard,
      result: result?.result,
    });

    if (remaining <= 0) {
      if (countdownInterval !== null) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }
  }, 1000);
}

function getPhaseDuration(phase: GamePhase): number {
  switch (phase) {
    case GamePhase.BET: return 10;
    case GamePhase.BET_ACCEPTANCE: return 3;
    case GamePhase.RESULT: return 4;
    case GamePhase.WIN_HANDLING: return 3;
    default: return 0;
  }
}

function emitGameState(extraData: Record<string, unknown> = {}): void {
  const duration = getPhaseDuration(currentPhase);
  const elapsed = Math.floor((Date.now() - phaseStartTimestamp) / 1000);
  const remainingTime = Math.max(0, duration - elapsed);
  emitMessage({ io: ioRef, room: gameRoom }, 'GAME_STATE', {
    phase: currentPhase,
    remainingTime,
    ...extraData,
  })
  // ioRef.to(gameRoom).emit('message', {
  //   type: 'GAME_STATE',
  //   data: {
  //     phase: currentPhase,
  //     remainingTime,
  //     ...extraData,
  //   },
  // });
}

export async function runBetPhase(): Promise<void> {
  try {
    let isShuffling = false;

    // ✅ If reshuffle is needed
    if (deckManager.hasCutCardBeenReached()) {
      isShuffling = true;
      deckManager.shuffleNewDeck();
      deckManager.resetCutCardFlag();

      // ⏳ Emit countdown each second
      let secondsLeft = 18;
      while (secondsLeft > 0) {
        ioRef.to(gameRoom).emit('message', {
          type: "shuffling",
          data: {
            secondsLeft,
            message: `Shuffling... starting in ${secondsLeft} second(s)`,
          }
        });
        await delay(1000);
        secondsLeft--;
      }
    }

    // ✅ This part runs *after* the optional delay or immediately if no reshuffling
    const { remainingCards, cutCardIndex } = deckManager.getDeckState();
    emitMessage({ io: ioRef, room: gameRoom }, 'DECK_STATUS', {
      remainingCards,
      cutCardIndex,
    });

    currentPhase = GamePhase.BET;
    phaseStartTimestamp = Date.now();
    currentRoundId = generateUUIDv7();
    emitMessage({ io: ioRef, room: gameRoom }, 'CURRENT_ROUNDID', { roundId: gameManager.getCurrentRoundId() });
    const lastCards = deckManager.getLastCards();
    emitMessage({ io: ioRef, room: gameRoom }, 'Last_Cards', { lastCards });

    void logInfo('Starting BET phase', {
      currentRoundId,
      phase: currentPhase,
      reshuffled: isShuffling,
    });

    emitGameState();
    startPhaseCountdownBroadcast();

    setTimeout(runBetAcceptancePhase, getPhaseDuration(GamePhase.BET) * 1000);
  } catch (error) {
    void logError('Error during BET phase', {
      error: (error as Error).message,
    });
  }
}

export async function runBetAcceptancePhase(): Promise<void> {
  try {
    let betObj: BetObj | undefined;
    currentPhase = GamePhase.BET_ACCEPTANCE;
    phaseStartTimestamp = Date.now();

    void logInfo('Starting BET_ACCEPTANCE phase', {
      currentRoundId,
      phase: currentPhase,
    });

    emitGameState();
    // 🕒 Wait a bit before validating bets to allow late bets to be added
    startPhaseCountdownBroadcast();
    setTimeout(async () => {
      betObj = await validateAndStore(currentRoundId);
      void logInfo('Bets validated and stored', { currentRoundId });
    }, 2000);
    setTimeout(async () => {
      await runResultPhase(betObj);
    }, getPhaseDuration(GamePhase.BET_ACCEPTANCE) * 1000);
  } catch (error) {
    void logError('Error during BET_ACCEPTANCE phase', {
      currentRoundId,
      error: (error as Error).message,
    });
  }
}

async function runResultPhase(betData?: BetObj): Promise<void> {
  try {
    console.log("result 6")
    currentPhase = GamePhase.RESULT;
    phaseStartTimestamp = Date.now();
    void logInfo('Starting RESULT phase', {
      currentRoundId,
    });
    const homeCard: Card = deckManager.drawCard();
    const awayCard: Card = deckManager.drawCard();
    const result = calculateResult(homeCard, awayCard);
    await redisClient.lpush('game:roundHistory', JSON.stringify({
      roundId: currentRoundId,
      homeCard,
      awayCard,
      result,
      timestamp: Date.now(),
    }));
    await redisClient.ltrim('game:roundHistory', 0, 9);
    void logRedis('Round result pushed to Redis', {
      roundId: currentRoundId,
      homeCard,
      awayCard,
      result,
    });
    deckManager.endRound();
    setResult(currentRoundId, { homeCard, awayCard, result });
    homeCard.rountId = currentRoundId;
    awayCard.rountId = currentRoundId;
    emitGameState({ homeCard, awayCard, result });
    const resultDraw: ResultDraw = { homeCard, awayCard, result }
    if (deckManager.hasCutCardBeenReached()) {
      // ioRef.to(gameRoom).emit('message', {
      //   type: 'CUT_CARD_DRAWN',
      //   data: { message: 'Cut card drawn. Deck will reshuffle next round.' }
      // });
      emitMessage({ io: ioRef, room: gameRoom }, "CUT_CARD_DRAWN", { message: 'Cut card drawn. Deck will reshuffle next round.' })
      void logInfo('Cut card drawn — reshuffle will occur next round', {
        roundId: currentRoundId,
      });
    }
    startPhaseCountdownBroadcast({ homeCard, awayCard, result });
    setTimeout(async () => {
      await runWinHandlingPhase(resultDraw, betData)
    }, getPhaseDuration(GamePhase.RESULT) * 1000);
  } catch (error) {
    void logError('Error in RESULT phase', {
      error: (error as Error).message,
      roundId: currentRoundId,
    });
  }

}

async function runWinHandlingPhase(resultDraw: ResultDraw, betData?: BetObj): Promise<void> {
  try {
    const { homeCard, awayCard, result } = resultDraw
    console.log("handle win 1")
    currentPhase = GamePhase.WIN_HANDLING;
    phaseStartTimestamp = Date.now();
    void logInfo('Starting WIN_HANDLING phase', {
      currentRoundId,
    });
    // let winAmount =
     await processWinners(currentRoundId, betData);
    // if (!winAmount) {
    //   winAmount = 0
    // }
   
    emitGameState({ homeCard, awayCard, result });
    void logInfo('Winners processed for round', {
      roundId: currentRoundId,
    });
    const history = await redisClient.lrange('game:roundHistory', 0, 9);
    const parsedHistory = history.map((h: string) => JSON.parse(h));
    emitMessage({ io: ioRef, room: config.ROOMID as string }, 'ROUND_HISTORY', parsedHistory);
    void logSocket('ROUND_HISTORY emitted to all players', {
      roundId: currentRoundId,
      totalRounds: parsedHistory.length,
    });
    // emitMessage(socket,"info",winDetails)
    startPhaseCountdownBroadcast({ homeCard, awayCard, result });
    setTimeout(runBetPhase, getPhaseDuration(GamePhase.WIN_HANDLING) * 1000);

  } catch (error) {
    void logError('Error in WIN_HANDLING phase', {
      error: (error as Error).message,
      roundId: currentRoundId,
    });
  }
}

function calculateResult(home: Card, away: Card): 'HOME' | 'AWAY' | 'DRAW' {
  console.log(home.value, away.value, 'home and away value');
  // if (home.value > away.value) return 'HOME';
  // if (home.value < away.value) return 'AWAY';
  // return 'DRAW';
  if (home.valueRank > away.valueRank) {
    return 'HOME'
  }
  else if (home.valueRank < away.valueRank) {
    return 'AWAY'
  }
  else {
    return 'DRAW'
  }
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// ---- Public API ----
export const gameManager = {
  start: (io: Server, roomId: string): void => {
    ioRef = io;
    // gameRoom = String(config.ROOMID);

    deckManager = createDeckManager(io, config.ROOMID as string);
    deckManagers.set(config.ROOMID as string, deckManager);
    // 🔁 Always shuffle at game start
    deckManager.shuffleNewDeck(); // This emits burn cards & cut card info
    void logInfo('New deck shuffled at game start', { roomId });
    deckManager.resetCutCardFlag();
    void logInfo('Cut card flag reset', { roomId });
    // ⏳ Delay first round by 5 seconds for frontend animation
    // setTimeout(() => {
    //   void runBetPhase();
    // }, 5000);
    let secondsLeft = 5;

    const intervalId = setInterval(() => {
      io.to(gameRoom).emit('shuffling', {
        secondsLeft,
        message: `Shuffling... starting in ${secondsLeft} second(s)`
      });
      secondsLeft--;

      if (secondsLeft === 0) {
        clearInterval(intervalId);
        void runBetPhase(); // Call your function
      }
    }, 1000);
  },
  getCurrentGameState: (): Record<string, unknown> => {
    const now = Date.now();
    const duration = getPhaseDuration(currentPhase) * 1000;
    const elapsed = now - phaseStartTimestamp;
    const remainingTime = Math.max(0, Math.ceil((duration - elapsed) / 1000));

    return {
      phase: currentPhase,
      remainingTime,
    };
  },
  getCurrentRoundId: (): string => currentRoundId,
  getCurrentPhase: (): string => currentPhase,
};

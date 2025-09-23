import { Server } from 'socket.io';
import { User } from '../interface/user.interface';
import { logError, logInfo, logSocket } from '../utilities/logger';
import { handleJoinGame } from './events/joinGame';
import { getHashField, setHashField } from '../utilities/redis-connecton';
import config from '../config/config';
import { emitMessage, fetchAndCacheUser, gameDetails } from '../utilities/common';
import registerSocketHandlers from '../routes/event-routes';
import { deckManagers, gameManager } from '../module/game/lobby';

export default function socketHandler(io: Server): void {
  io.on('connection', async (socket) => {
    const token: string = socket.handshake.query.token as string;
    let gameSettings = await getHashField(`GD:${config.GAME_NAME}`);
    if (!gameSettings?.game_id) {
      gameSettings = await gameDetails();
      if (gameSettings?.data.length) {
        const data = gameSettings.data[0]
        await setHashField(`GD:${config.GAME_NAME}`, { data })
      } else {
        console.error("error in fetiching gamedata", gameSettings)
        return socket.emit("message", {
          action: "error",
          msg: "No Game ID found "
        })
      }
    }

    const gameId: string = gameSettings?.game_id as string;
    let user: User;

    void (async (): Promise<void> => {
      try {
        void logSocket('New socket connection initiated', {
          socketId: socket.id,
          gameId,
        });

        user = await fetchAndCacheUser(token, socket, io, gameId);
        socket.data.userInfo = user;
        const chip = [10, 20, 50, 100, 500, 1000]
        const deckManager = deckManagers.get(config.ROOMID as string);
        if (deckManager) {
          const { remainingCards, cutCardIndex } = deckManager.getDeckState();
          const lastCards = deckManager.getLastCards()
          let cardData={remainingCards, cutCardIndex}
          emitMessage(socket, 'info', { user, chip, data:cardData });
          emitMessage(socket,'CURRENT_ROUNDID',{roundId:gameManager.getCurrentRoundId(),})
          emitMessage(socket,"Last_Cards",{lastCards})
        } else {
          emitMessage(socket, 'info', {
            user: {
              userId: user.user_id,
              balance: user.balance,
              name: user.name,
              operatorId: user.operatorId,
            },
            chip,
            data: { remainingCards: 0, cutCardIndex: 0 }
          });
          emitMessage(socket,'CURRENT_ROUNDID',{roundId:gameManager.getCurrentRoundId(),})
        }
        const draw = config.multiplier.OTHER;
        const multiplier = {
          home: `${config.multiplier.OTHER}x`,
          away: `${config.multiplier.OTHER}x`,
          draw: `${config.multiplier.DRAW}x`
        };
        emitMessage(socket, "gameData",multiplier)
        // You may want to provide a valid message object for emitMessage
        // Example:
        // emitMessage(socket, "gameData", { multiplier, draw });
        // emitMessage(socket, 'info', { user, chip, remainingCards, cutCardIndex });
        void logInfo('User authenticated and cached', {
          socketId: socket.id,
          userId: user.user_id
        });

        void handleJoinGame(io, user, socket, { token, gameId });

        // Emit current game state to the connected socket
        // try {
        //   const gameState = gameManager.getCurrentGameState();
        //   emitToSocket(socket, 'GAME_STATE', gameState);
        //   void logSocket('Emitted current GAME_STATE to user', {
        //     socketId: socket.id,
        //     userId: user.user_id,
        //   });
        // } catch (e) {
        //   void logError('Failed to fetch game state', {
        //     socketId: socket.id,
        //     error: (e as Error).message,
        //   });
        // }

        registerSocketHandlers(io, socket);
        void logSocket('Socket handlers registered for user', {
          socketId: socket.id,
          userId: user.user_id,
        });

      } catch (error) {
        void logError('Authentication failed for socket connection', {
          socketId: socket.id,
          error: (error as Error).message,
        });
        void logSocket('Socket disconnected due to failed auth', {
          socketId: socket.id,
        });
        socket.disconnect();
      }
    })();
  });
}


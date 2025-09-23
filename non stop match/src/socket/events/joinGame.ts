import { Server, Socket } from 'socket.io';
import config from '../../config/config';
import { User } from '../../interface/user.interface';
import { JoinGamePayload } from '../../interface/common';
import { logError, logSocket, logRedis } from '../../utilities/logger';
import { emitMessage } from '../../utilities/common';
import { gameManager } from '../../module/game/lobby';
import { redisClient } from '../../utilities/redis-connecton';

export async function handleJoinGame(io: Server, user: User, socket: Socket, data: JoinGamePayload): Promise<void> {
  try {
    const { token, gameId } = data;
    if (!token || !gameId) {
      emitMessage(socket, 'ERROR', { message: 'token and gameId required' });
      void logError('JoinGame failed due to missing token or gameId', {
        socketId: socket.id,
        token,
        gameId,
      });
      return;
    }

    const room = String(config.ROOMID);

    socket.data.user = user;
    socket.data.userInfo = user;

    await socket.join(room);
    void logSocket('User joined room', {
      socketId: socket.id,
      userId: user.user_id,
      room,
    });

    const userCount = io.sockets.adapter.rooms.get(room)?.size || 0;
    emitMessage(socket, 'JOIN_SUCCESS', { user, gameId });
    emitMessage({ io, room }, 'PLAYER_COUNT_UPDATE', { count: userCount });

    void logSocket('Emitted JOIN_SUCCESS and PLAYER_COUNT_UPDATE', {
      userId: user.user_id,
      room,
      userCount,
    });
    // Emit current game state to the connected socket
    try {
      const gameState = gameManager.getCurrentGameState();
      emitMessage(socket, 'GAME_STATE', gameState);
      void logSocket('Emitted current GAME_STATE to user', {
        socketId: socket.id,
        userId: user.user_id,
      });
    } catch (e) {
      void logError('Failed to fetch game state', {
        socketId: socket.id,
        error: (e as Error).message,
      });
    }
    const roundHistoryRaw = await redisClient.lrange('game:roundHistory', 0, 9);
    const roundHistory = roundHistoryRaw.map((r: string) => JSON.parse(r));
    emitMessage(socket, 'ROUND_HISTORY', roundHistory);
    void logRedis('Fetched and emitted round history', {
      userId: user.user_id,
      count: roundHistory.length,
    });

  } catch (err) {
    const errorMessage = (err as Error).message;
    void logError('Failed to handle join game', {
      error: errorMessage,
      socketId: socket.id,
      userId: socket.data?.userInfo?.user_id,
    });

    emitMessage(socket, 'ERROR', { message: 'Failed to join game' });
  }
}


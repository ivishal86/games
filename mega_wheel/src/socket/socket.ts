import { Server, Socket } from 'socket.io';
import { User } from '../interface';
import { emitSocketMessage, registerSocketEvents } from '../routes/event.routes';
import { logError, logSocket } from '../utilities/logger';
import { fetchAndCacheUser } from '../module/controller/user.controller';
import { EVENT_TYPES } from './events';
import { getHashField, getRedisClient, redisClient, setHashField } from '../utilities/redis-connecton';
import config from '../config/config';
import { gameDetails } from '../utilities/common';
import { getGameConfig, userDashboardHistory } from '../utilities/helper';
// import { getGameConfig, userDashboardHistory } from '../utilities/helper';

export default function socketHandler(io: Server): void {
  io.on('connection', async (socket: Socket) => {
    console.log("👉 Handshake details:", {
      headers: socket.handshake.headers,
      address: socket.handshake.address,
      time: socket.handshake.time,
      url: socket.handshake.url,
    });
    console.log('Client connected:', socket.id);
    void logSocket(`Client connected`, { socketId: socket.id, ip: socket.handshake.address });

    const token = socket.handshake.query.token;
    // const gameId = socket.handshake.query.game_id;
    const redisClient = getRedisClient();
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
    const gameId = gameSettings?.game_id;

    let user: User;

    void (async (): Promise<void> => {
      try {
        if (typeof token !== 'string') {
          void logSocket('Invalid token received', { socketId: socket.id, token });
          throw new Error('Invalid token');
        }

        user = await fetchAndCacheUser(token, socket, io, gameId as string);

        socket.data.userInfo = user;
        emitSocketMessage({
          socket,
          action: EVENT_TYPES.GAME_CONFIG,
          message: getGameConfig(),
        });
        emitSocketMessage({
          socket,
          action: EVENT_TYPES.info,
          message: { user_id: user.user_id, balance: Number(user.balance), operatorId: user.operatorId },
        })
        await userDashboardHistory(socket);
        registerSocketEvents(socket, io);
      } catch (error) {
        void logError('Authentication failed for socket connection', {
          socketId: socket.id,
          error: (error as Error).message,
        });
        emitSocketMessage({
          socket,
          action: EVENT_TYPES.Error,
          message: `${(error as Error).message}`,
        })
        void logSocket('Socket disconnected due to failed auth', { socketId: socket.id });
        socket.disconnect();
      }
    })();

    socket.on('disconnect', () => {
      const user = socket.data.userInfo as User | undefined;
      console.log("📴 Client disconnected:", socket.id);
      if (!user) return;

      const redisKey = `user:${user.user_id}:${user.operatorId}`;
      if (redisClient) {
        const currentSocketId = void redisClient.hget(redisKey, 'socket');
        if (currentSocketId === socket.id) {
          void redisClient.hset(redisKey, { socket: '' });
        }
      }
    });
  });
}

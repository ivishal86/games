import { Server, Socket } from 'socket.io';
import { logError, logInfo, logRedis } from '../../utilities/logger';
import { User } from '../../interface';
import { disconnectPreviousSocket, getUserFromApi } from '../../utilities/common';
import { redisClient } from '../../utilities/redis-connection';

export const fetchAndCacheUser = async (token: string, socket: Socket, io: Server, gameId: string): Promise<User> => {
  try {
    const user = await getUserFromApi(token)
    console.log('User details fetched--',user)
    user.gameId = gameId;

    // Encode user ID for Redis key safety

    user.user_id = encodeURIComponent(user.user_id);
    await disconnectPreviousSocket(user.user_id, user.operatorId, io);

    const redisKey = `user:${user.user_id}:${user.operatorId}`;
    const redisData = {
      userId: user.user_id,
      name: user.name,
      balance: user.balance,
      operatorId: user.operatorId,
      token,
      socket: socket.id,
      gameId
    };

    if (!redisClient) {
      throw new Error('Redis client is not initialized');
    }
    await redisClient.hset(redisKey, redisData);
    await redisClient.expire(redisKey, 3600);  
    console.log('User Data saved in redis--',redisData)
    socket.data["userInfo"] = user;
    void logRedis('User cached in Redis', { key: redisKey, data: redisData });
    void logInfo('User cache saved in redis', { user: user.user_id, socketId: socket.id });
    return user;

  } catch (error) {
    void logError(`Error fetching user: ${error}`);
    throw new Error(`${error}`);
  }
};

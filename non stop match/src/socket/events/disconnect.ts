import { Server, Socket } from 'socket.io';
import config from '../../config/config';

export function handleDisconnect(io: Server, socket: Socket, reason: string): void {
  const roomId = config.ROOMID
  const room = roomId ? `room${roomId}` : null;
  if (room) {
    const userCount = io.sockets.adapter.rooms.get(room)?.size || 0;
    io.to(room).emit('message', { type: 'PLAYER_COUNT_UPDATE', data: { count: userCount } });
  }

  console.log(`[SOCKET DISCONNECTED] ${socket.id} (${reason})`);
}

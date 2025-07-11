import { Server, Socket } from 'socket.io';
import { SocketMessage } from '../interface';
import { throwArrow } from '../module/game/gamePlay';
import { EVENT_TYPES, SOCKET_EVENTS } from '../socket/events';
import { BetPayload } from '../interface/forestFortune.interface';
import { handleDifficultyChange } from '../utilities/helper';

export function registerSocketEvents(socket: Socket, io: Server): void {
  socket.on(SOCKET_EVENTS.ACTION, async (msg: SocketMessage) => {
    const { eventName, data } = msg;
    switch (eventName) {
      case EVENT_TYPES.THROW_ARROW:
        await throwArrow(socket, io, data as BetPayload);
        break;
      case EVENT_TYPES.DIFFICULTY_CHANGE:
        handleDifficultyChange(socket, data);
        break;

      default:
        socket.emit(SOCKET_EVENTS.MESSAGE, {
          eventName: EVENT_TYPES.Error,
          data: `Unknown event type: ${eventName}`,
        });
    }
  });
}

export function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.MESSAGE, {
    eventName: EVENT_TYPES.Error,
    data: message,
  });
}
interface EmitMessageOptions<T> {
  socket: Socket;
  eventName: keyof typeof EVENT_TYPES;
  data: T;
}
export function emitSocketMessage<T>({ socket, eventName, data }: EmitMessageOptions<T>): void {
  socket.emit(SOCKET_EVENTS.MESSAGE, {
    eventName,
    data,
  });
}

import { Server, Socket } from 'socket.io';
import { placeBet } from '../module/game/gamePlay';
import { EVENT_TYPES, SOCKET_EVENTS } from '../socket/events';
import { validateBetString } from '../utilities/helper';
import { BetPayload } from '../interface/teenPatti.interface';

export function registerSocketEvents(socket: Socket, io: Server): void {
  socket.on(SOCKET_EVENTS.ACTION, async (msg: string) => {
    try {
      const [action] = msg.split(':');
  
      // const [action, betAmount, betOn
      // ] = msg.split(':');
      const data = validateBetString(socket, msg);
      switch (action) {
        case EVENT_TYPES.Place_Bet:
          // PB:betOn-betAmount,betOn-betAmount,betOn-betAmount
          await placeBet(socket, io, data as BetPayload);
          break;
        // case EVENT_TYPES.join_game:
        //   console.log("Game joined:", msg);
        //   emitSocketMessage({ socket, action: EVENT_TYPES.joined, message: { message: "user joined" } })
        //   break;
        default:
          socket.emit(SOCKET_EVENTS.MESSAGE, {
            action: EVENT_TYPES.Error,
            message: `Unknown event type: ${action}`,
          });
      }
    } catch (error) {
      void emitSocketMessage({
          socket,
          action: EVENT_TYPES.Error,
          message: `${(error as Error).message}`,
        })
    }
  });
}

export function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.MESSAGE, {
    action: EVENT_TYPES.Error,
    message,
  });
}
interface EmitMessageOptions<T> {
  socket: Socket;
  action: keyof typeof EVENT_TYPES;
  message: T;
}
export function emitSocketMessage<T>({ socket, action, message }: EmitMessageOptions<T>): void {
  socket.emit(SOCKET_EVENTS.MESSAGE, {
    action,
    message,
  });
}

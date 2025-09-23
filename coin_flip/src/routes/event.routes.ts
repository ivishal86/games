import { Server, Socket } from 'socket.io';
import { placeBet } from '../module/game/gamePlay';
import { EVENT_TYPES, SOCKET_EVENTS } from '../socket/events';
import { emitValidationError } from '../utilities/helper';

export function registerSocketEvents(socket: Socket, io: Server): void {
  socket.on(SOCKET_EVENTS.ACTION, async (msg: string) => {
    // const { eventName, data } = msg;
    const betPattern = /^PB:([-+]?\d*\.?\d+):(1|2)$/;

    if (!betPattern.test(msg)) {
      return emitValidationError(socket, "Invalid format for place bet.");
    }

    const [action, betAmount, betOn
    ] = msg.split(':');
    switch (action) {
      case EVENT_TYPES.Place_Bet:
        // PB:betAmount:betOn

        await placeBet(socket, io, { betAmount, betOn });
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
  });
}

export function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.MESSAGE, {
    action: EVENT_TYPES.Error,
    message: message,
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

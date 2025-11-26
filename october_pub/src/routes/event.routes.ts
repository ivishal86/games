import { Server, Socket } from 'socket.io';
import { EVENT_TYPES, SOCKET_EVENTS } from '../socket/events';
import { getUserFromRedis } from '../utilities/helper';
import { doWithdraw, placeGPBet, startRound, withdrawCupWin } from '../module/game/gamePlay';

export function registerSocketEvents(socket: Socket, io: Server): void {
  socket.on(SOCKET_EVENTS.ACTION, async (rawPayload: string) => {
  const user = await getUserFromRedis(socket);
try {
      if (typeof rawPayload !== "string") {
        emitError(socket, "Invalid payload type: expected string.");
        return;
      }

      const payload = rawPayload.trim();
      if (!payload) {
        emitError(socket, "Empty action payload.");
        return;
      }

      // const { userId, operatorId } = getAuthIds(socket);
      // if (!userId || !operatorId) {
      //   emitError(socket, "Missing userId or operatorId. Provide them in socket.auth or socket.data.");
      //   return;
      // }

      const cmd = payload.split(":")[0].toUpperCase();

      switch (cmd) {
        // START:1,2,3|2:20
        case "START": {
          // Basic validation here; deeper validation occurs in startRound
          // Ensure presence of '|' and ':' as expected
          if (!payload.includes("|") || !payload.includes(":")) {
            emitError(socket, "START format invalid. Expected START:selectedCsv|betOn:betAmount (e.g. START:1,2,3|2:20)");
            return;
          }

          // Delegate to gamePlay.startRound which must:
          // - create/reset state in redis
          // - set selected cups, open flags
          // - set fixed per-cup bet amount for the round
          // - place initial debit(s) as required
          await startRound({ socket, io, payload });
          return;
        }

        // GP:<cupId>  (place a bet on the cup using the per-cup bet amount decided in START)
        case "GP": {
          const parts = payload.split(":");
          if (parts.length !== 2) {
            emitError(socket, "GP format invalid. Expected GP:<cupId> (e.g. GP:1)");
            return;
          }
          const cupId = parseInt(parts[1], 10);
          if (!Number.isInteger(cupId) || cupId < 1 || cupId > 5) {
            emitError(socket, "Invalid cupId in GP.");
            return;
          }

          // Delegate to gamePlay.placeGPBet which must:
          // - validate allowed/selected/alive
          // - debit the per-cup bet from user (or mark pending)
          // - resolve win/lose, update win amount in redis
          // - emit updated GAME_STATE and userInfo after debit
          await placeGPBet({ socket, io, cupId });
          return;
        }

        // CO -> withdraw (client asked to collect wins)
        case "CO": {
          // Delegate to gamePlay.doWithdraw which must:
          // - finalize debits/credits if necessary
          // - perform payout logic (or emit instructions to do so)
          // - reset the user's game state
          await doWithdraw({ socket, io });
          return;
        }

        case "WC": {
          // Delegate to gamePlay.doWithdraw which must:
          // - finalize debits/credits if necessary
          // - perform payout logic (or emit instructions to do so)
          // - reset the user's game state
          const parts = payload.split(":");
          if (parts.length !== 2) {
            emitError(socket, "GP format invalid. Expected GP:<cupId> (e.g. GP:1)");
            return;
          }
          const cupId = parseInt(parts[1], 10);
          if (!Number.isInteger(cupId) || cupId < 1 || cupId > 5) {
            emitError(socket, "Invalid cupId in GP.");
            return;
          }
          await withdrawCupWin({ socket, io,cupId });
          return;
        }

        // ER -> end round (no payout, just reset)
        // case "ER": {
        //   // Delegate to gamePlay.endRound which must:
        //   // - reset the user's state without paying out
        //   await doWithdraw({ socket, io });
        //   return;
        // }

        default: {
          emitError(socket, `Unknown command: ${cmd}`);
          return;
        }
      }
    } catch (err: any) {
      console.error("Unhandled error in action router:", err);
      emitError(socket, err?.message ?? "Internal server error");
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

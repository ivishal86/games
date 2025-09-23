import { Server, Socket } from 'socket.io';
import { handleDisconnect } from '../socket/events/disconnect';
import { emitMessage } from '../utilities/common';
import { handlePlaceBet } from '../module/game/game';

export default function registerSocketHandlers(io: Server, socket: Socket): void {
  console.log(`[SOCKET CONNECTED] ${socket.id}`);
  //place bet : PB:beton-betamount,beton-betamount,beton-betamount
  //ex-PB:1-10,2-10,3-10
  socket.on('action', async (raw: string) => {
    try {
      const [eventType,
        // payloadData
      ] = raw.split(':');

      switch (eventType) {
        case 'PB':
          return handlePlaceBet(io, socket, { betString: raw });
        // case 'GET_GAME_STATE': {
        //   const state = gameManager.getCurrentGameState();
        //   return emitToSocket(socket, 'GAME_STATE', state);
        // }
        default:
          console.warn(`[UNHANDLED ACTION] ${eventType}`);
          return emitMessage(socket, 'ERROR', { message: 'Unsupported action type.' });
      }
    } catch (err) {
      console.error('[SOCKET HANDLER ERROR]', err);
      return emitMessage(socket, 'ERROR', { message: 'Internal server error' });
    }
  });

  socket.on('disconnect', (reason) => {
    handleDisconnect(io, socket, reason);
  });
}
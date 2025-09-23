import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import config from './config/config';
import gameSocket from './socket/socket';
import { connect } from './utilities/amqp';
import { initializeRedis, setHashField } from './utilities/redis-connecton';
import userRoutes from './routes/user.route';
import {
  logInfo,
  logError,
  logAmqp,
  logSocket
} from './utilities/logger';
import { checkForRollBack } from './utilities/rollback';
import { gameDetails } from './utilities/common';
import { gameManager } from './module/game/lobby';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
  pingInterval: 1000, // Ping every 1 seconds
  pingTimeout: 1000,
  path: "/socket.io"
});

app.get('/', (req, res) => {
  res.send('Non-Stop Match Game Server is Running');
});

app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json());
app.use('/routes', userRoutes);

async function startServer(): Promise<void> {
  try {
    void (async (): Promise<void> => {
      await initializeRedis();
    })();

    await connect();
    void logAmqp('✅ AMQP connected');
    await checkForRollBack();
    const gameData = await gameDetails();

    if (gameData.data.length) {
      const data = gameData.data[0]
      await setHashField(`GD:${config.GAME_NAME}`, data)
    } else {
      console.error("error in fetiching gamedata", gameData)
    }
    gameManager.start(io, config.ROOMID as string );
    void logInfo('🎮 Game Manager started');

    gameSocket(io);
    void logSocket('🔌 Socket.io initialized');

    server.listen(config.PORT, () => {
      void logInfo(`🚀 Server listening on port ${config.PORT}`);
    });
  } catch (error) {
    void logError('❌ Startup error', { error });
    process.exit(1);
  }
}

void startServer();

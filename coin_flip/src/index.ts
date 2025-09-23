import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIO } from 'socket.io';
import config from './config/config';
import userRoutes from './routes/user.routes';
import gameSocket from './socket/socket';
import { pool } from './db/db';
import { connect } from './utilities/amqp';
import { checkForRollBack } from './utilities/rollback';
import { createRedisClient, setHashField } from './utilities/redis-connecton';
import { gameDetails } from './utilities/common';

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: config.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
  pingInterval: 1000, // Ping every 1 seconds
  pingTimeout: 1000,
  path: "/socket.io",
  transports: ["websocket", "polling"],
});

// Middleware
app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json());

// Routes
app.use('/routes', userRoutes);



// Socket setup


// Raw MySQL connection test before starting the server
async function startServer(): Promise<void> {
  try {
    const connection = await pool.getConnection();
    await connection.ping(); // Test connection
    connection.release();
    console.log('Database connection successful');
    void createRedisClient()
    // .then(() => console.log('Redis connected'))
    // .catch(console.error);

    await connect()
      .then(() => console.log('AMQP connected'))
      .catch(console.error);

    await checkForRollBack();
    const gameData = await gameDetails();

    if (gameData.data.length) {
      const data = gameData.data[0]
      await setHashField(`GD:${config.GAME_NAME}`, data)
    } else {
      console.error("error in fetching gamedata", gameData)
    }
    gameSocket(io);
    app.get('/', (req, res) => {
      res.send("heads and tails is Up and working")
      console.log("heads and tails is Up and working")
    })

    server.listen(config.PORT, () => {
      console.log(`Server listening on port ${config.PORT}`);
    });
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
}

void startServer();

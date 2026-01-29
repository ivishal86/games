import { Server, Socket } from "socket.io";
import { getUserDataFromSource } from "../controllers/playerHandler";
import { messageRouter } from "../routes/messageRouter";
import { httpServer } from "../../server";
import { deleteCache, getCache, setCache } from "../../common/cache/redis";
import type { IWalletInfo } from "../../common/interfaces";
import { Wallets } from "../../modules/wallets/models/wallets";
import { requiredInfo, requiredWalletInfo } from "../../common/utilities/helperFunc";
import { joinRoom, reconnect } from "../controllers/socketHandler";
import { initMarketDataCron } from "../../modules/markets/controllers/marketData";

export const io = new Server(httpServer, { cors: { origin: "*" } });

(async () => { await initMarketDataCron(io) })()

io.on("connection", async (socket: Socket) => {
    const { token, game_id, mid } = socket.handshake.query as { token: string; game_id: string, mid: string };

    if (!token || !game_id) {
        socket.disconnect(true);
        console.log('GameId and Token are required', token);
        return;
    };

    let userData = await getUserDataFromSource(token, game_id);

    if (!userData) {
        socket.emit("tradeError", "Session token expired")
        socket.disconnect(true);
        return;
    };

    const prevSid = await getCache(userData.id);
    const existSocket = io.sockets.sockets.get(prevSid) || null;

    if (existSocket) {
        existSocket.disconnect(true);
    };

    await deleteCache(`WL:${prevSid}`);
    let userWallet: IWalletInfo = await Wallets.get(userData.user_id, userData.operator_id);

    if (!userWallet) {
        userWallet = {
            user_id: userData.user_id,
            operator_id: userData.operator_id,
            balance: 0,
            txn_id: '',
        } as IWalletInfo;
        await Wallets.create(userWallet);
    };

    userWallet.game_id = game_id;
    userWallet.token = token;
    userWallet.id = userData.id;
    userWallet.isLocked = false;
    userWallet.operatorBalance = userData.balance;

    await setCache(userWallet.id, socket.id);
    socket.emit("walletInfo", requiredWalletInfo(userWallet));
    socket.emit("info", requiredInfo(userData));

    const overallProfit = await Wallets.getOverallProfit(userWallet.user_id, userWallet.operator_id);
    socket.emit("overallProfit", overallProfit);
    await reconnect(userWallet, socket);

    if (mid) joinRoom(socket, [mid], userWallet);
    messageRouter(socket);

    socket.emit("markets", {
        liveMatches: await getCache("currentMatches") || [],
        upcomingMatches: await getCache("upcomingMatches") || []
    })

    socket.on('disconnect', async () => {
        console.log("Disconnected user", socket.id);
    });

    socket.on('error', (error: Error) => {
        console.error(`Socket error: ${socket.id}. Error: ${error.message}`);
    });
});
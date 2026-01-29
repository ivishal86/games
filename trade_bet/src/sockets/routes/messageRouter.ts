import { Socket } from "socket.io";
import { historyData, joinRoom, leaveRoom, userTrades } from "../controllers/socketHandler";
import { placeTrade } from "../../modules/trades/controllers/tradeHandler";
import { processExitHandler } from "../../modules/trades/services/tradeServices";

export const messageRouter = async (socket: Socket): Promise<void> => {
    socket.on("message", async (data: string) => {

        if (!data || typeof data != "string") return socket.emit("tradeError", "Invalid request payload");

        const [event, ...payload] = data.trim().split(":");

        switch (event.toUpperCase()) {
            case "PB": await placeTrade(socket, payload); break;
            case "EX": await processExitHandler(socket, payload); break;
            case "OT": await userTrades(socket); break;
            case "JN": await joinRoom(socket, payload); break;
            case "LR": await leaveRoom(socket, payload); break;
            case "HS": await historyData(socket, payload.join(":")); break;
        }

    });

    socket.on("error", (error: Error) => {
        console.error(`Socket error: ${socket.id}. Error: ${error.message}`);
    });
}
import { createLogger } from "./logger";
import type { Info, IWalletInfo } from "../interfaces";
import { io } from "../../sockets/connections/serverSocket";
import { deleteCache } from "../cache/redis";

export const failedTradeLogger = createLogger("failedTrades", "jsonl");
export const failedTradeQueueLogger = createLogger("failedTradesQueue", "jsonl");
export const failedCashoutLogger = createLogger("failedCashout", "jsonl");
export const failedExitLogger = createLogger("failedExit", "jsonl");
export const systemLogger = createLogger("systemLogs", "jsonl");
export const systemErrorLogger = createLogger("systemErrorLogs", "jsonl");


interface RequestData { [key: string]: any; }

type EventType = "system" | "system_error" | "trade" | "exit" | "cashout" | "jn" | "lr" | "hs" | "ot";

export const logEventAndEmitResponse = async (sid: string, event: EventType, req: RequestData, res: string): Promise<void> => {
    const logData = JSON.stringify({ req, res });

    switch (event) {
        case "trade":
            failedTradeLogger.error(logData);
            break;
        case "cashout":
            failedCashoutLogger.error(logData);
            break;
        case "exit":
            failedExitLogger.error(logData);
            break;
        case "system":
            systemLogger.info(logData);
            break;
        case "system_error":
            systemLogger.error(logData);
            break;
    }
    await deleteCache(req.tradeKey)
    io.to(sid).emit("tradeError", res)
    return;
};

export const requiredInfo = (info: Info) => { return { urId: info.user_id, bl: Number(info.balance), operator_id: info.operator_id } }
export const requiredWalletInfo = (wallet: IWalletInfo) => {
    return {
        urId: wallet?.user_id,
        balance: Number(wallet?.balance) ?? 0.00,
        operator_id: wallet?.operator_id
    }
}
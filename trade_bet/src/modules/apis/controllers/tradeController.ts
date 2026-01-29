import type { Request, Response } from "express";
import { getEventListService, getEventProfitLossReport, getEventWiseList, getFilteredInGameStatementService, getProfitLossService, getStatementService, getTradeHistoryService } from "../services/tradeService";
import { history, inGameStatements, eventStatement, profitLoss, adminInGameStatements, eventProfitLoss, segregateEventsByDate } from "../services/tradeMappers";
import { Transactions } from "../../wallets/models/transactions";

// STATEMENT
export async function statement(req: Request, res: Response) {
    try {
        let { user_id, operator_id, limit = 30 } = req.query;

        user_id = String(user_id);
        operator_id = String(operator_id);

        const result = await getStatementService(user_id, operator_id, Number(limit));
        if (!result) return res.status(400).send({ status: false, msg: "Invalid player details" });


        const data = await eventStatement(result);
        return res.status(200).send({ status: true, data });

    } catch (err) {
        console.error("statement error:", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
}

// TRADE HISTORY
export async function tradeHistory(req: Request, res: Response) {
    try {
        const { user_id, operator_id, limit = 10 } = req.query;

        const rows = await getTradeHistoryService(String(user_id), String(operator_id), Number(limit));

        const data = await history(rows);
        return res.status(200).send({ status: true, data });

    } catch (err) {
        console.error("tradeHistory error:", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
}

//  IN-GAME STATEMENTS
export async function fetchFilteredInGameStatements(req: Request, res: Response) {
    try {
        let { user_id, operator_id, type, event, market, fromDate, toDate, limit } = req.query;

        const userId = String(user_id);
        const operatorId = String(operator_id);
        const limitNum = Number(limit) || 30;

        if (!userId || !operatorId || !limitNum) return res.status(400).send({ status: false, msg: 'missing mandatory params' });

        const userStatement =
            await getFilteredInGameStatementService({
                user_id: userId,
                operator_id: operatorId,
                type: type as string,
                event: event as string,
                market: market as string,
                fromDate: fromDate as string,
                toDate: toDate as string,
                limit: limitNum
            });

        const userTransactions = await Transactions.getTxn(userId, operatorId, limitNum);

        const rows = [...userStatement];
        let txnIndex = 0;
        let pushedTxns = 0;
        const maxTxnsToPush = userStatement.length;

        for (let i = 0; i < rows.length && txnIndex < userTransactions.length; i++) {
            while (txnIndex < userTransactions.length && userTransactions[txnIndex].created_at > rows[i].created_at && pushedTxns < maxTxnsToPush) {
                rows.splice(i, 0, userTransactions[txnIndex]);
                txnIndex++;
                pushedTxns++;
                i++;
            }
        }

        while (txnIndex < userTransactions.length && pushedTxns < maxTxnsToPush) {
            rows.push(userTransactions[txnIndex++]);
            pushedTxns++;
        }

        const data = await inGameStatements(rows, limitNum);

        return res.status(200).json({ status: true, data });

    } catch (err) {
        console.error("fetchFilteredInGameStatements error:", err);
        return res.status(500).json({
            status: false,
            msg: "Internal Server Error"
        });
    }
};

export async function getTradeProfitLoss(req: Request, res: Response) {
    try {
        let { user_id, operator_id, limit = 30 } = req.query;

        user_id = String(user_id);
        operator_id = String(operator_id);

        const rows = await getProfitLossService(user_id, operator_id, Number(limit));

        if (!rows) {
            return res.status(400).send({ message: "Invalid player details", data: { summary: [], details: [] } });
        };

        const data = await profitLoss(rows);
        return res.status(200).send({ status: true, data });

    } catch (err) {
        console.error("profitLoss error:", err);
        return res.status(500).send({ status: false, message: "Internal Server Error" });
    }
};

//  EVENT LIST
export async function getEventList(req: Request, res: Response) {
    try {
        const data = await getEventListService();
        return res.status(200).send({ status: true, ...data });
    } catch (err) {
        console.error("getEventList error:", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};

export async function getEvents(req: Request, res: Response) {
    try {
        const rows = await getEventWiseList();
        const data = segregateEventsByDate(rows);
        return res.status(200).send({ status: true, data });
    } catch (err) {
        console.error("getEventList error:", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};

export const getEventWiseReportForAdmin = async (req: Request, res: Response) => {
    try {
        const { event_name, event_start_date } = req.query;

        if (!event_name || !event_start_date) {
            return res.status(400).send({ status: false, msg: "Missing necassary paramters" });
        };

        const eventName = decodeURIComponent(String(req.query.event_name));
        const eventStartDate = new Date(String(req.query.event_start_date)).toISOString().replace('T', ' ').slice(0, -5);
        const rows = await getEventProfitLossReport(eventName, eventStartDate);

        if (!rows) {
            return res.status(400).send({ status: false, msg: "No data found for the given event" });
        };

        const data = await eventProfitLoss(rows);
        return res.status(200).send({ status: true, data });
    } catch (err) {
        console.error("getEventList error:", err);
        return res.status(500).send({ status: false, msg: "Internal Server Error" });
    }
};
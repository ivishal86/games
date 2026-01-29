import { getCache } from "../../../common/cache/redis";
import { pool } from "../../../common/database/mysqldb";

// Fetch Statement (grouped by event + markets)
export async function getStatementService(user_id: string, operator_id: string, limit = 30) {

    const query = `
        SELECT event_name, event_start_date, market_name, runner_name, trade_time, trade_odds, co_odds, co_req_odds, bonus, stop_loss, target_profit, max_cap,
        stake, win_amt, cat, status, created_at, reason
        FROM settlements
        WHERE user_id = ? AND operator_id = ?
        ORDER BY trade_time DESC LIMIT ${limit}
    `;

    const [rows]: any = await pool.query(query, [user_id, operator_id]);
    return rows
};

export async function getTradeHistoryService(user_id: string, operator_id: string, limit = 10) {
    const query = `
        SELECT event_name, market_name, runner_name, trade_odds, reason, stop_loss, target_profit, max_cap,
        stake, win_amt, cat, status, created_at
        FROM settlements
        WHERE user_id = ? AND operator_id = ?
        ORDER BY trade_time DESC LIMIT ${limit}
    `;

    const [rows]: any = await pool.query(query, [user_id, operator_id]);
    return rows;
};

export interface FilterParams {
    user_id?: string;
    operator_id?: string;
    type?: string;
    event?: string;
    market?: string;
    fromDate?: string;
    toDate?: string;
    limit: number
}

export interface PaginationParams {
    page: number;
    limit: number;
}

export async function getFilteredInGameStatementService(params: FilterParams) {
    const { user_id, operator_id, type, event, market, fromDate, toDate, limit } = params;

    let query = `SELECT user_id, event_name, event_start_date, market_name, trade_odds, co_odds, co_req_odds, stop_loss, target_profit, max_cap, trade_time, bonus, runner_name, reason, stake, win_amt, balance, updated_balance, cat, status, created_at, updated_balance_at FROM settlements WHERE user_id = ? and operator_id = ?`;

    const values: any[] = [user_id, operator_id];

    if (type === "PROFIT") query += ` AND win_amt > 0`;
    if (type === "LOSS") query += ` AND win_amt < 0`;

    if (event) {
        query += ` AND event_name LIKE ?`;
        values.push(`%${event}%`);
    }

    if (market) {
        query += ` AND market_name LIKE ?`;
        values.push(`%${market}%`);
    }

    if (fromDate) {
        query += ` AND DATE(created_at) >= ?`;
        values.push(fromDate);
    }

    if (toDate) {
        query += ` AND DATE(created_at) <= ?`;
        values.push(toDate);
    }

    query += ` ORDER BY updated_balance_at DESC LIMIT ${limit}`;

    const [rows]: any = await pool.query(query, values);
    return rows;
};

export async function countFilteredInGameStatements(params: FilterParams) {

    const { user_id, operator_id, type, event, market, fromDate, toDate } = params;

    let query = `SELECT COUNT(*) as total FROM settlements WHERE 1=1`;

    const values: any[] = [];

    if (user_id && user_id !== "undefined") {
        query += ` AND user_id = ?`;
        values.push(user_id);
    }

    if (operator_id && operator_id !== "undefined") {
        query += ` AND operator_id = ?`;
        values.push(operator_id);
    }

    if (type === "PROFIT") query += ` AND win_amt > 0`;
    if (type === "LOSS") query += ` AND win_amt < 0`;

    if (event) {
        query += ` AND event_name LIKE ?`;
        values.push(`%${event}%`);
    }

    if (market) {
        query += ` AND market_name LIKE ?`;
        values.push(`%${market}%`);
    }

    if (fromDate) {
        query += ` AND DATE(created_at) >= ?`;
        values.push(fromDate);
    }

    if (toDate) {
        query += ` AND DATE(created_at) <= ?`;
        values.push(toDate);
    }

    const [[row]]: any = await pool.query(query, values);
    return row.total;
};

export async function getEventListService() {
    const liveMatches = await getCache("currentMatches");
    const upcomingMatches = await getCache("upcomingMatches");
    return { liveMatches, upcomingMatches };
};

export async function getProfitLossService(user_id: string, operator_id: string, limit = 30) {
    const query = `SELECT * FROM settlements WHERE user_id = ? AND operator_id = ? ORDER BY created_at DESC LIMIT ${limit}`;
    const [rows]: any = await pool.query(query, [user_id, operator_id]);
    return rows;
};

export async function getEventProfitLossReport(event_name: string, event_start_date: string) {
    const query = `SELECT * FROM settlements WHERE event_name = ${event_name} and event_start_date = '${event_start_date}'`;
    const [rows]: any = await pool.query(query);
    return rows;
};

export async function getEventWiseList() {
    const query = `SELECT event_name, event_start_date FROM settlements group by event_name, event_start_date ORDER BY event_start_date DESC`;
    const [rows]: any = await pool.query(query);
    return rows;
};


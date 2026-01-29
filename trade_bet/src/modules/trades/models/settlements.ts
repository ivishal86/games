import { pool } from "../../../common/database/mysqldb";
import type { IDbSettlementObject } from "../../../common/interfaces";

export class Settlements {
    static async create(data: IDbSettlementObject) {
        const { user_id, operator_id, trade_time, slug, balance, trade_odds, co_odds, stake, win_amt, cat, status, market_exchange, bonus, updated_balance, updated_balance_at, eventDate, eventName, marketName, runnerName, reason, target_profit, stop_loss, max_cap, co_req_odds } = data;
        const query = `insert into settlements (user_id, operator_id, trade_time, event_name, market_name, runner_name, event_start_date, slug, balance, trade_odds, co_odds, stake, win_amt, bonus, updated_balance, updated_balance_at, cat, status, market_exchange, reason, target_profit, stop_loss, max_cap, co_req_odds) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [{ inserId }]: any = await pool.execute(query, [user_id, operator_id, trade_time, eventName, marketName, runnerName, new Date(eventDate), slug, Number(balance.toFixed(2)), trade_odds, co_odds, stake, Number(win_amt.toFixed(2)), bonus, Number(updated_balance.toFixed(2)), updated_balance_at, cat, status, market_exchange, reason, target_profit, stop_loss, max_cap, co_req_odds]);
        return inserId;
    }
};
import { pool } from "../../../common/database/mysqldb";
import type { IDbTradeObject } from "../../../common/interfaces";

export class Trades {
    static async create(data: IDbTradeObject) {
        const {
            user_id,
            operator_id,
            trade_time,
            slug,
            trade_odds,
            stake,
            cat,
            market_exchange,
            eventName,
            eventDate,
            runnerName,
            marketName,
            target_profit,
            stop_loss,
            max_cap
        } = data;

        const query = `
            INSERT INTO trades (
                user_id,
                operator_id,
                trade_time,
                event_name,
                market_name,
                runner_name,
                event_start_date,
                slug,
                trade_odds,
                stake,
                cat,
                market_exchange,
                target_profit,
                stop_loss,
                max_cap
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;

        const [{ insertId }]: any = await pool.execute(query, [
            user_id,
            operator_id,
            trade_time,
            eventName,
            marketName,
            runnerName,
            new Date(eventDate),
            slug,
            trade_odds,
            stake,
            cat,
            market_exchange,
            target_profit,
            stop_loss,
            max_cap
        ]);

        return insertId;
    }
}

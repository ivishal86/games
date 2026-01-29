import { getCache, setCache } from "../../../common/cache/redis";
import { pool } from "../../../common/database/mysqldb";
import type { IWallet } from "../../../common/interfaces";


export class Wallets {
    static async create(data: IWallet) {
        const { user_id, operator_id, txn_id, balance } = data;
        const query = `INSERT INTO wallets (user_id, operator_id, txn_id, balance) VALUES (?, ?, ?, ?) `;
        const [result]: any = await pool.execute(query, [
            user_id,
            operator_id,
            txn_id,
            balance,
        ]);
        return result.insertId;
    }

    static async getBalance(user_id: string, operator_id: string) {
        const query = `SELECT balance FROM wallets WHERE user_id = ? AND operator_id = ? ORDER BY created_at DESC LIMIT 1 `;
        const [rows]: any = await pool.execute(query, [user_id, operator_id]);
        return rows[0]?.balance ?? 0;
    }

    static async get(user_id: string, operator_id: string) {
        const query = `SELECT * FROM wallets WHERE user_id = ? AND operator_id = ?`;
        const [rows]: any = await pool.execute(query, [user_id, operator_id]);
        return rows[0];
    }

    static async updateBalance(user_id: string, operator_id: string, newBalance: number, txn_id: string | null) {
        const query = `UPDATE wallets SET txn_id = ?, balance = ? where  user_id = ? AND operator_id = ?`;
        await pool.execute(query, [txn_id, newBalance, user_id, operator_id]);
        return true;
    }
    //to be cached
    static async getOverallProfit(user_id: string, operator_id: string) {
        const profitKey = `OP:${user_id}:${operator_id}`;
        let overallProfit = await getCache(profitKey);
        if (overallProfit) return Number(overallProfit);
        const query = `select sum(case when reason = 'negative_balance' then win_amt - bonus else win_amt end) as profit FROM settlements where user_id = ? AND operator_id = ? AND created_at >= CURDATE()`;
        const [rows]: any = await pool.execute(query, [user_id, operator_id]);
        const userProfit = rows[0]?.profit ?? 0;
        if (userProfit) await setCache(profitKey, userProfit);
        return userProfit;
    }
}

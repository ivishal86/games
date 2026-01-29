import { pool } from "../../../common/database/mysqldb";
import type { ITransaction } from "../../../common/interfaces";

export class Transactions {
    static async create(data: ITransaction) {
        const { user_id, operator_id, amount, session_token, updated_balance, type, credit_txn_id = null, debit_txn_id } = data;
        const query = `INSERT INTO transactions (user_id, operator_id, session_token, amount, updated_balance, type, credit_txn_id, debit_txn_id ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        try {
            const [result]: any = await pool.execute(query, [user_id, operator_id, session_token, amount, updated_balance, type, credit_txn_id, debit_txn_id]);
            return result.insertId;
        } catch (error: any) {
            console.error("Error inserting transaction:", error.message);
            throw new Error("Failed to insert transaction record");
        }
    };

    static async getTxn(user_id: string, operator_id: string, limit: number = 30) {
        let query = `SELECT * FROM transactions where user_id = ? and operator_id = ? ORDER BY created_at DESC LIMIT ${limit}`;
        const [rows]: any = await pool.query(query, [user_id, operator_id]);
        return rows;
    };

    static async getLastRecallTxn(user_id: string, operator_id: string) {
        let query = `SELECT * FROM transactions where user_id = ? and operator_id = ? and type = 'CREDIT' ORDER BY created_at DESC LIMIT 1`;
        const [rows]: any = await pool.query(query, [user_id, operator_id]);
        return rows;
    };

}

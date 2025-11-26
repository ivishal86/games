import { RowDataPacket } from "mysql2";
import { pool } from "../db/db";
import { BetData, MatchHistoryRow, SaveBetInput, UpdateBetResultParams, UserBetHistory } from "../interface/octoberPub";
import { BetAttributes, RollbackUpdateInput } from "../interface";
import { logDatabase } from "./logger";
import { calculateAverageMultiplier } from "./helper";

export async function insertBet(betData: BetAttributes): Promise<void> {
  const query = `
    INSERT INTO bet (
      userId, betId, matchId, operatorId, betAmount,
      betData, betStatus, betRequest, BetResponse,
      betTxnId, isDeclared, result, resultStatus,
      resultTxnId, winAmount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    betData.userId,
    betData.betId,
    betData.matchId,
    betData.operatorId,
    betData.betAmount,
    JSON.stringify(betData.betData),
    betData.betStatus,
    JSON.stringify(betData.betRequest),
    betData.BetResponse,
    betData.betTxnId,
    betData.isDeclared,
    JSON.stringify(betData.result),
    betData.resultStatus,
    betData.resultTxnId,
    betData.winAmount,
  ];

  const [result] = await pool.execute(query, values);
  void logDatabase('Bet result insert in database', { result })
  return;
}
export async function saveBetToDB(data: SaveBetInput): Promise<void> {
  const query = `
    INSERT INTO bets (
      user_id, bet_id, match_id, round_id, operator_id, bet_amount, bet_response,
      bet_request, bet_txn_id, is_declared, result_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    data.userId,
    data.betId,
    data.matchId,
    data.roundId,
    data.operatorId,
    data.betAmount,
    data.betResponse,
    // JSON.stringify(data.betData),
    // data.betStatus,
    JSON.stringify(data.betRequest),
    // data.betResponse,
    data.betTxnId,
    data.isDeclared ? 1 : 0,
    data.resultStatus,
  ];

  try {
    await pool.query(query, values);
    console.log('Bet saved to database.');
  } catch (error) {
    console.error('Error saving bet to DB:', error);
    void logDatabase('DB Insert failed', { error })
    if (error instanceof Error) {
      throw new Error(`${error.message}`);
    } else {
      throw new Error('Unknown error occurred while saving bet to DB');
    }
  }
}


export async function updateBetResult(params: UpdateBetResultParams, status: string): Promise<void> {
  try {
    const fields: string[] = [];
    const values: any[] = [];

    // Dynamically add fields if provided
    if (params.betStatus) {
      fields.push('bet_status = ?');
      values.push(params.betStatus);
    }
    if (params.betResponse) {
      fields.push('Bet_response = ?');
      values.push(params.betResponse);
    }
    if (params.betData) {
      fields.push('bet_data = ?');
      values.push(JSON.stringify(params.betData));
    }
    if (params.resultRequest) {
      fields.push('result_request = ?');
      values.push(JSON.stringify(params.resultRequest));
    }
    if (typeof params.isDeclared !== 'undefined') {
      fields.push('is_declared = ?');
      values.push(params.isDeclared);
    }

    if (params.result) {
      fields.push('result = ?');
      values.push(JSON.stringify(params.result));
    }

    if (params.resultStatus) {
      fields.push('result_status = ?');
      values.push(params.resultStatus);
    }

    if (params.resultTxnId) {
      fields.push('result_txn_id = ?');
      values.push(params.resultTxnId);
    }

    if (typeof params.winAmount !== 'undefined') {
      fields.push('win_amount = ?');
      values.push(params.winAmount);
    }

    // Add WHERE clause
    let sql;
    if (status == 'win') {
      sql = `UPDATE bets SET ${fields.join(', ')} WHERE bet_id = ? AND bet_txn_id = ? AND user_id = ? AND match_id = ? AND round_id = ? AND result_txn_id is NULL`;
      values.push(params.betId, params.betTxnId, params.userId, params.matchId, params.roundId);
    } else {
      sql = `UPDATE bets SET ${fields.join(', ')} WHERE bet_id = ? AND bet_txn_id = ? AND user_id = ? AND match_id = ? `;
      values.push(params.betId, params.betTxnId, params.userId, params.matchId);
    }

    await pool.query(sql, values);
  } catch (error) {
    console.error('Error updating bet:', error);
    throw new Error('DB_UPDATE_FAILED');
  }
}
export async function getUserHistoryFromDB(userId: string, operatorId: string): Promise<UserBetHistory[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT 
    match_id, 
      user_id, 
      bet_id, 
      bet_amount,
      win_amount,
      bet_data, 
      result,
      created_at
    FROM bets
    WHERE user_id = ? AND operator_id = ? AND result_status !=? AND bet_data IS NOT NULL AND result IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 25
  `, [decodeURIComponent(userId), operatorId, 'rollback']);

  const formatted = rows.map((row: RowDataPacket) => {
    let parsedData: BetData = {} as BetData;

    try {
      parsedData = typeof row.bet_data === 'string' ? JSON.parse(row.bet_data) : row.bet_data;
    } catch {
      parsedData = {} as BetData;
    }
    const multiplier = calculateAverageMultiplier(row.bet_amount, row.win_amount)
    return {
      bet_id: row.bet_id,
      user_id:row.user_id,
      match_id: row.match_id,
      bet_amount: row.bet_amount,
      win_amount: row.win_amount,
      multiplier,
      bet_data: parsedData,
      result: row.result,
      created_at:row.created_at
    };
  });

  return formatted;
}

export async function fetchMatchHistoryFromDB(user_id: string, operator_id: string, match_id: string): Promise<MatchHistoryRow[]> {
  const [rows] = await pool.query(
  `
    SELECT 
      match_id,
      user_id,
      operator_id,
      bet_amount,
      win_amount,
      bet_data,
      created_at
    FROM 
      bets
    WHERE 
      user_id = ? AND 
      operator_id = ? AND 
      match_id = ?
    ORDER BY created_at ASC
    `,
    [decodeURIComponent(user_id), operator_id, match_id]
  );

  return rows as MatchHistoryRow[];
}

export async function updateRollback({
  betTransactionId,
  userId,
  matchId,
  resultStatus,
}: RollbackUpdateInput): Promise<void> {
  try {
    const query = `
      UPDATE bets
      SET result_status = ?, updated_at = NOW()
      WHERE bet_txn_id = ? AND user_id = ? AND match_id = ?
    `;

    const [result] = await pool.query(query, [resultStatus, betTransactionId, decodeURIComponent(userId), matchId]);

    const updateResult = result as RowDataPacket;
    if (updateResult.affectedRows === 0) {
      console.warn('No rows were updated. Please verify the identifiers.');
    }
  } catch (error) {
    console.error('Error updating rollback status in DB:', error);
    throw new Error('DB update failed during rollback');
  }
}

export async function getLastRounds(userId: string): Promise<UserBetHistory[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT 
    match_id, 
      user_id, 
      bet_id, 
      bet_amount,
      win_amount,
      bet_data, 
      result,
      created_at
    FROM bets
    WHERE user_id = ? AND result_status !=? AND bet_data IS NOT NULL AND result IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 8
  `, [decodeURIComponent(userId), 'rollback']);

  const formatted = rows.map((row: RowDataPacket) => {
    let parsedData: BetData = {} as BetData;

    try {
      parsedData = typeof row.bet_data === 'string' ? JSON.parse(row.bet_data) : row.bet_data;
    } catch {
      parsedData = {} as BetData;
    }
    const multiplier = calculateAverageMultiplier(row.bet_amount, row.win_amount)
    return {
      bet_id: row.bet_id,
      user_id:row.user_id,
      match_id: row.match_id,
      bet_amount: row.bet_amount,
      win_amount: row.win_amount,
      multiplier,
      bet_data: parsedData,
      result: row.result,
      created_at:row.created_at
    };
  });

  return formatted;
}
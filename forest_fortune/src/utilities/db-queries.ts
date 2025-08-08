import { RowDataPacket } from "mysql2";
import { pool } from "../db/db";
import { MatchHistoryRow, SaveBetInput, UpdateBetResultParams, UserBetHistory } from "../interface/forestFortune.interface";
import { calculateAverageMultiplier, calculateAverageMultipliers } from "./helper";
import { BetAttributes, BetObj, RollbackUpdateInput } from "../interface";
import { logDatabase } from "./logger";

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
  void logDatabase('Bet result insert in database',{result})
  return;
}
export async function saveBetToDB(data: SaveBetInput): Promise<void> {
  const query = `
    INSERT INTO bet (
      userId, betId, matchId, operatorId, betAmount,
      betRequest, betTxnId, isDeclared, resultStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    data.userId,
    data.betId,
    data.matchId,
    data.operatorId,
    data.betAmount,
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
    throw new Error('DB_INSERT_FAILED');
  }
}


export async function updateBetResult(params: UpdateBetResultParams,status:string): Promise<void> {
  try {
    const fields: string[] = [];
    const values: any[] = [];

    // Dynamically add fields if provided
    if (params.betStatus) {
      fields.push('betStatus = ?');
      values.push(params.betStatus);
    }
    if (params.betResponse) {
      fields.push('BetResponse = ?');
      values.push(params.betResponse);
    }
    if (params.betData) {
      fields.push('betData = ?');
      values.push(JSON.stringify(params.betData));
    }
    if (params.resultRequest) {
      fields.push('resultRequest = ?');
      values.push(JSON.stringify(params.resultRequest));
    }
    if (typeof params.isDeclared !== 'undefined') {
      fields.push('isDeclared = ?');
      values.push(params.isDeclared);
    }

    if (params.result) {
      fields.push('result = ?');
      values.push(JSON.stringify(params.result));
    }

    if (params.resultStatus) {
      fields.push('resultStatus = ?');
      values.push(params.resultStatus);
    }

    if (params.resultTxnId) {
      fields.push('resultTxnId = ?');
      values.push(params.resultTxnId);
    }

    if (typeof params.winAmount !== 'undefined') {
      fields.push('winAmount = ?');
      values.push(params.winAmount);
    }

    // Add WHERE clause
    let sql;
    if(status=='win'){
       sql = `UPDATE bet SET ${fields.join(', ')} WHERE betId = ? AND betTxnId = ? AND userId = ? AND matchId = ? AND resultTxnId is NULL`;
      values.push(params.betId,params.betTxnId,params.userId,params.matchId);
    }else{
       sql = `UPDATE bet SET ${fields.join(', ')} WHERE betId = ? AND betTxnId = ? AND userId = ? AND matchId = ? `;
      values.push(params.betId,params.betTxnId,params.userId,params.matchId);
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
      matchId,
      betId,
      betAmount,
      winAmount,
      createdAt,
      betData
    FROM bet
    WHERE userId = ? AND operatorId = ? AND resultStatus !=? AND betData IS NOT NULL AND result IS NOT NULL
    ORDER BY createdAt DESC
    LIMIT 20
  `, [userId, operatorId,'rollback']);

  const formatted = rows.map((row: RowDataPacket) => {
    let parsedData: BetObj = {} as BetObj;
    let parsedResult: any = null;

    try {
      parsedData = typeof row.betData === 'string' ? JSON.parse(row.betData) : row.betData;
    } catch {
      parsedData = {} as BetObj;
    }
    try {
      parsedResult = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
    } catch {
      parsedResult = row.result;
    }
    const multiplier = calculateAverageMultipliers(row.betAmount,row.winAmount);

    return {
      matchId:row.matchId,
      betId: row.betId,
      betAmount: row.betAmount,
      winAmount: row.winAmount,
      createdAt: row.createdAt,
      multiplier,
      result:parsedResult
    };
  });

  return formatted;
}




export async function fetchMatchHistoryFromDB(userId: string, operatorId: string, matchId: string): Promise<MatchHistoryRow[]> {
  const [rows] = await pool.query(
    `
    SELECT 
      matchId,
      userId,
      operatorId,
      betAmount,
      winAmount,
      betData,
      createdAt
    FROM 
      bet
    WHERE 
      userId = ? AND 
      operatorId = ? AND 
      matchId = ?
    ORDER BY createdAt ASC
    `,
    [userId, operatorId, matchId]
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
      UPDATE bet
      SET resultStatus = ?, updatedAt = NOW()
      WHERE betTxnId = ? AND userId = ? AND matchId = ?
    `;

    const [result] = await pool.query(query, [resultStatus, betTransactionId, userId, matchId]);

    const updateResult = result as RowDataPacket;
    if (updateResult.affectedRows === 0) {
      console.warn('No rows were updated. Please verify the identifiers.');
    }
  } catch (error) {
    console.error('Error updating rollback status in DB:', error);
    throw new Error('DB update failed during rollback');
  }
}
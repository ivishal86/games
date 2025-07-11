import mysql, { RowDataPacket } from 'mysql2/promise';
import config from '../config/config';
import { logDatabase } from '../utilities/logger';
import { BetAttributes, BetObj } from '../interface';
import { MatchHistoryRow, UserBetHistory } from '../interface/forestFortune.interface';
import { calculateAverageMultiplier } from '../utilities/helper';

export const pool = mysql.createPool({
   host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

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

export async function getUserHistoryFromDB(userId: string, operatorId: string): Promise<UserBetHistory[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT 
      betId,
      betAmount,
      winAmount,
      createdAt,
      betData
    FROM bet
    WHERE userId = ? AND operatorId = ?
    ORDER BY createdAt DESC
    LIMIT 20
  `, [userId, operatorId]);

  const formatted = rows.map((row: RowDataPacket) => {
    let parsedData: BetObj = {} as BetObj;

    try {
      parsedData = typeof row.betData === 'string' ? JSON.parse(row.betData) : row.betData;
    } catch {
      parsedData = {} as BetObj;
    }

    const multiplier = calculateAverageMultiplier(parsedData);

    return {
      betId: row.betId,
      betAmount: row.betAmount,
      winAmount: row.winAmount,
      createdAt: row.createdAt,
      multiplier,
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

interface RollbackUpdateInput {
  betTransactionId: string;
  userId: string;
  matchId: string;
  resultStatus: string;
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
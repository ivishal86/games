import { Request, Response } from 'express';
import { BetObj } from '../../interface';
import { StatusCodes } from 'http-status-codes';
import { MatchHistoryRow } from '../../interface/forestFortune.interface';
import { calculateAverageMultiplier } from '../../utilities/helper';
import { logError } from '../../utilities/logger';
import { fetchMatchHistoryFromDB, getUserHistoryFromDB } from '../../utilities/db-queries';

export async function getMatchHistory(req: Request, res: Response): Promise<void> {
  const { user_id, operator_id, lobby_id } = req.query;

  if (!user_id || !operator_id || !lobby_id) {
    res.status(StatusCodes.BAD_REQUEST).json({
      status: false,
      message: 'Missing required query parameters: user_id, operator_id, lobby_id',
    });
    return;
  }

  try {
    const rawData = await fetchMatchHistoryFromDB(
      String(user_id),
      String(operator_id),
      String(lobby_id)
    );

    if (!rawData.length) {
      res.status(StatusCodes.NOT_FOUND).json({
        status: false,
        message: 'No history found',
        data: {},
      });
      return;
    }

    const formattedData: Record<string, Record<string, string | number>> = {};

    rawData.forEach((row: MatchHistoryRow, index: number): void => {
      let betData: Partial<BetObj> = {};
      try {
        betData = typeof row.betData === 'string' ? JSON.parse(row.betData) : row.betData;
      } catch {
        betData = {};
      }

      formattedData[`bet${index + 1}`] = {
        lobby_id: row.matchId,
        user_id: row.userId,
        operator_id: row.operatorId,
        bet_amount: row.betAmount,
        win_amount: row.winAmount,
        created_at: row.createdAt,
        multiplier: calculateAverageMultiplier(betData as BetObj),
      };
    });

    res.status(StatusCodes.OK).json({
      status: true,
      message: 'User history fetched successfully',
      data: formattedData,
    });
  } catch (error) {
    console.error('Error fetching match history:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: 'Internal server error',
      data: {},
    });
  }
}


export async function getUserBetHistory(req: Request, res: Response): Promise<void> {
  const userId = req.headers['user_id'] as string;
  const operatorId = req.headers['operator_id'] as string;
  const token = req.headers['token'] as string;

  if (!userId || !operatorId || !token) {
     res.status(StatusCodes.BAD_REQUEST).json({
      status: false,
      message: 'Missing headers: user_id, operator_id, or token',
    });
    return;
  }

  try {
    const data = await getUserHistoryFromDB(userId, operatorId);
    res.json({
      status: true,
      message: 'Bet history fetched successfully',
      data,
    });
  } catch (error) {
    void logError(`Db Error - ${error}`)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: 'Internal server error',
    });
  }
}


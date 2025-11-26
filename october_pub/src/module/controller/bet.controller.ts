import { Request, Response } from 'express';
import { BetObj } from '../../interface';
import { StatusCodes } from 'http-status-codes';
import { BetData, MatchHistoryRow } from '../../interface/octoberPub';
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
      let betData: Partial<BetData> = {};
      try {
        betData = typeof row.bet_data === 'string' ? JSON.parse(row.bet_data) : row.bet_data;
      } catch {
        betData = {};
      }

      formattedData[`bet${index + 1}`] = {
        lobby_id: row.match_id,
        user_id: row.user_id,
        operator_id: row.operator_id,
        bet_amount: row.bet_amount,
        win_amount: row.win_amount,
        created_at: row.created_at,
        // multiplier: calculateAverageMultiplier(betData as BetObj),
        // muiltiplier:((betData.payout && betData.betAmount)?(betData.payout / betData.betAmount):0) as number
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


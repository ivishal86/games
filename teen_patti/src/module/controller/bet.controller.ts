import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { BetData, MatchHistoryRow } from '../../interface/teenPatti.interface';
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
    let betIndex = 1;

    rawData.forEach((row: MatchHistoryRow): void => {
      let betData: BetData[] = [];
      try {
        betData = typeof row.bet_data === 'string' ? JSON.parse(row.bet_data) : row.bet_data;
      } catch {
        betData = [];
      }

      if (Array.isArray(betData) && betData.length > 0) {
        betData.forEach((singleBet) => {
          formattedData[`bet${betIndex}`] = {
            lobby_id: row.match_id,
            user_id: row.user_id,
            operator_id: row.operator_id,
            bet_amount: singleBet.betAmount as number,
            win_amount: singleBet.payout as number,
            created_at: row.created_at,
          };
          betIndex++;
        });
      } else {
        formattedData[`bet${betIndex}`] = {
          lobby_id: row.match_id,
          user_id: row.user_id,
          operator_id: row.operator_id,
          bet_amount: row.bet_amount,
          win_amount: row.win_amount,
          created_at: row.created_at,
        };
        betIndex++;
      }
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
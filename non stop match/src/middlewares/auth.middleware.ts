import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getUserFromApi } from '../utilities/common';
import { error } from 'console';

export async function validateUserHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.headers['user_id'] as string;
  const operatorId = req.headers['operator_id'] as string;
  const token = req.headers['token'] as string;

  if (!userId || !operatorId || !token) {
    res.status(StatusCodes.BAD_REQUEST).json({
      status: false,
      message: 'Missing required headers: user_id, operator_id, or token',
    });
    return;
  }

  try {
    const user = await getUserFromApi(token);

    if (user.user_id === userId && user.operatorId === operatorId) {
      next();
      return;
    }

    res.status(StatusCodes.FORBIDDEN).json({
      status: false,
      message: 'Invalid user credentials',
    });
  } catch {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: 'Internal server error while validating user',
    });
  }
}

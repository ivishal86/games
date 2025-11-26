import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getUserFromApi } from '../utilities/common';

export async function validateUserHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.headers['user_id'] as string;
  const operatorId = req.headers['operator_id'] as string;
  const token = req.headers['token'] as string;

  // ✅ Validate required headers
  if (!userId || !operatorId || !token) {
    res.status(StatusCodes.BAD_REQUEST).json({
      status: false,
      message: 'Missing required headers: user_id, operator_id, or token',
    });
    return;
  }

  try {
    const user = await getUserFromApi(token);

    // ✅ Check if user details match the headers
    console.log("from api:",user.user_id,"from client:" ,decodeURIComponent(userId))
    if (user.user_id === decodeURIComponent(userId) && user.operatorId === operatorId) {
      next();
      return;
    }

    res.status(StatusCodes.FORBIDDEN).json({
      status: false,
      message: 'Invalid user credentials provided',
    });
  } catch (error: any) {
    // ✅ Send clean and understandable error message
    res.status(StatusCodes.UNAUTHORIZED).json({
      status: false,
      message: error.message || 'Unable to validate user at this moment',
    });
  }
}
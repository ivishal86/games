import type { NextFunction, Request, Response } from "express";

export const globalErrorHandler = (err: any, _: Request, res: Response, _next: NextFunction): Response => {
    console.error("Error occured:", err.stack);
    return res.status(500).send({
        statusCode: 500,
        message: err.message || "internal server error",
        errorStack: process.env.NODE_ENV === "developement" ? err.stack : {}
    })
}

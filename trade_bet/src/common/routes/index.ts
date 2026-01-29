import { type Request, type Response, Router } from "express";

export const router = Router();

router.get('/', (_: Request, res: Response) => {
    return res.status(200).send({ status: true, msg: "Trade Trade Server is up and running" });
});




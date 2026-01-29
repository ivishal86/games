import { Router } from "express";
import { creditAdminDebitWallet, debitAdminCreditWallet, fetchWallet } from "../controllers/walletsHandler";

export const router = Router();

router
    .get("/", fetchWallet)
    .post("/deposit", debitAdminCreditWallet)
    .post("/withdraw", creditAdminDebitWallet);
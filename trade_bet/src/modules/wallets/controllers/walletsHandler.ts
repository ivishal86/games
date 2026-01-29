import type { Request, Response } from "express";
import { randomUUID } from "crypto";

import { Wallets } from "../models/wallets";
import { Transactions } from "../models/transactions";
import { config } from "../../../configs/appConfig";
import { updateBalanceFromAccount } from "../../../common/utilities/commonFunction";
import type { Info, IWalletInfo } from "../../../common/interfaces";
import { getCache, setCache } from "../../../common/cache/redis";

export const debitAdminCreditWallet = async (req: Request, res: Response) => {
    try {
        const { amount, sid } = req.body;
        if (!amount || !sid) return res.status(400).json({ status: false, message: "Missing required fields" });
        if (amount < config.minDepositAmount) return res.status(400).json({ status: false, message: `Deposit amount should be atleast ${config.minDepositAmount}` });
        const walletKey = `WL:${sid}`;
        const wallet: IWalletInfo = await getCache(walletKey);
        if (!wallet) return res.status(400).json({ status: false, message: "Invalid Session Request" });

        if (!wallet) return res.status(400).json({ status: false, message: "Invalid Session Request" });
        if (wallet.operatorBalance < amount) return res.status(400).json({ status: false, message: "Insufficient Balance" });

        if (wallet.isLocked) return res.status(400).json({ status: false, message: "Deposit not allowed during active trades." });

        const dbtTxn = await updateBalanceFromAccount({
            id: randomUUID(),
            trade_amount: amount,
            game_id: wallet.game_id,
            user_id: wallet.user_id,
            ip: req.ip || req.socket.remoteAddress,
        }, 'DEBIT', { ...wallet, token: wallet.token, operator_id: wallet.operator_id });

        if (!dbtTxn.txn_id) return res.status(400).json({ status: false, message: "Deposit failed" });

        wallet.balance += amount;
        wallet.txn_id = dbtTxn.txn_id;
        wallet.operatorBalance -= amount;
        const updatedWallet = await Wallets.updateBalance(wallet.user_id, wallet.operator_id, wallet.balance, dbtTxn.txn_id);
        if (!updatedWallet) throw new Error("Wallet Update Unsuccessful");

        const txn = await Transactions.create({
            user_id: wallet.user_id,
            operator_id: wallet.operator_id,
            session_token: wallet.token,
            amount: amount,
            updated_balance: wallet.balance,
            type: "DEBIT",
            credit_txn_id: "",
            debit_txn_id: dbtTxn.txn_id,
        });
        if (!txn) console.error("Transaction Log Failed", wallet.user_id, wallet.operator_id, amount, wallet, dbtTxn.txn_id);

        await setCache(walletKey, wallet);

        return res.status(200).json({ status: true, message: "transferred to your trade wallet", balance: Number(wallet.balance).toFixed(2), deposit: Number(amount).toFixed(2), operatorBalance: Number(wallet.operatorBalance).toFixed(2) });

    } catch (error: any) {
        console.error("Credit error:", error);
        res.status(500).json({ status: false, message: "Internal Server Error" });
    }
};

export const creditAdminDebitWallet = async (req: Request, res: Response) => {
    try {
        const { amount, sid } = req.body;
        if (!amount || !sid) return res.status(400).json({ status: false, message: "Missing required fields" });

        const walletKey = `WL:${sid}`;
        const wallet: IWalletInfo = await getCache(walletKey);
        if (!wallet || !wallet.txn_id) return res.status(400).json({ status: false, message: "Invalid Session Request" });

        if (wallet.isLocked) return res.status(400).json({ status: false, message: "Credit not allowed during active trades." });

        if (!wallet || wallet.balance < amount) return res.status(400).json({ status: false, message: "Invalid withdrawl amount" });
        if (wallet.balance != amount) return res.status(400).send({ status: false, message: "Invalid credit request" });

        const [getLastRecall] = await Transactions.getLastRecallTxn(wallet.user_id, wallet.operator_id);
        if (getLastRecall && ((new Date().getTime() - new Date(getLastRecall.created_at).getTime()) / (1000 * 60 * 60)) < 3) {
            return res.status(400).send({ status: false, message: "Recall is allowed only after 3 hours of last recall." });
        }

        const cdtTxn = await updateBalanceFromAccount({
            id: wallet.txn_id,
            winning_amount: amount,
            game_id: wallet.game_id,
            user_id: wallet.user_id,
            txn_id: wallet.txn_id,
            ip: req.ip || req.socket.remoteAddress,
        }, 'CREDIT', wallet);

        wallet.balance -= amount; // TL;DR: WILL USE IT IN NEXT RELEASE
        wallet.operatorBalance = Number(wallet.operatorBalance) + amount;
        const updatedWallet = await Wallets.updateBalance(wallet.user_id, wallet.operator_id, 0, null);
        if (!updatedWallet) console.error("Wallet Update Unsuccessful", wallet.user_id, wallet.operator_id, wallet);

        const txn = await Transactions.create({
            user_id: wallet.user_id,
            operator_id: wallet.operator_id,
            session_token: wallet.token,
            amount: amount,
            updated_balance: 0,
            type: "CREDIT",
            credit_txn_id: cdtTxn.txn_id,
            debit_txn_id: wallet.txn_id,
        });
        if (!txn) console.error("Transaction Log Failed", { userId: wallet.user_id, pperatorId: wallet.operator_id, amount, balance: wallet.balance, txn: wallet.txn_id });

        await setCache(walletKey, wallet);
        return res.status(200).json({ status: true, message: "transferred to your main wallet", balance: Number(wallet.balance).toFixed(2), withdraw: Number(amount).toFixed(2), operatorBalance: Number(wallet.operatorBalance).toFixed(2) });
    } catch (error: any) {
        console.error("Credit error:", error);
        res.status(500).json({ status: false, message: "Internal Server Error" });
    }
};

export const fetchWallet = async (req: Request, res: Response) => {
    try {
        const sid = req.query.sid;
        if (!sid) return res.status(400).json({ status: false, message: "Missing required fields" });

        const walletKey = `WL:${sid}`;
        const wallet: Info = await getCache(walletKey);
        if (!wallet) return res.status(400).json({ status: false, message: "Invalid Session Request" });
        let userWallet = await Wallets.get(wallet.user_id, wallet.operator_id);

        return res.status(200).send({ status: true, message: "Wallet fetched Successfully", ...userWallet });
    } catch (error: any) {
        console.error("Debit error:", error.message);
        res.status(500).json({ status: false, message: "Internal Server Error" });
    }
}
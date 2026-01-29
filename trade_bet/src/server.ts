import express, { urlencoded, json } from "express";
import { createServer } from "http";
import { config } from "dotenv";
import cors from "cors";
import { router as indexRouter } from "./common/routes/index";
import { router as walletRouter } from "./modules/wallets/routes/wallet";
import { globalErrorHandler } from "./common/middlewares/errorHandler";
import apiRouter from "./modules/apis/routes/tradeRoutes";

config({ path: ".env" });

export const app = express();
export const httpServer = createServer(app);

app.use(cors({ origin: "*" }));
app.use(json());
app.use(urlencoded({ extended: true }));

app.use("/", apiRouter);
app.use("/health-check", indexRouter);
app.use("/wallet", walletRouter);

app.use(globalErrorHandler);

/*
let x = {
    '-1.251025305:90023847:1': ['ashwini_2990:devteam_7071'],
    '1.251028063:77233831:1': ['vishal_3777:devteam_7071']
}
let y = {
    'ashwini_2990:devteam_7071': {
        ttlBl: 99070,
        ttlProfit: -1650.0000000000077,
        sId: 'dgPvVCRg6dPvAs_NAAAJ',
        user_id: 'ashwini_2990',
        token: '019ac937-7e7e5e55-716e-8c5350-c0',
        game_id: '202',
        operator_id: 'devteam_7071',
        ip: '106.51.64.55',
        '-1.251025305:90023847:1': [{
            stake: 10,
            odds: 1.75,
            runningOdds: 3.8,
            category: 1,
            slug: '-1.251025305:90023847:1',
            id: '019ac9b6-acad7338-7286-8ac984-ba',
            profit: -2049.9999999999995,
            trade_amount: 100720,
            trdTm: '2025-11-28T09:06:23.533Z',
            updtBl: 99070,
            updtBlAt: '2025-11-28T10:42:06.969Z',
            txn_id: '019ac8f6-aae4d86e-7f40-8fd3bc-76'
        }]
    },
    'vishal_3777:devteam_7071': {
        ttlBl: 12029,
        ttlProfit: 0,
        sId: 'AZ54ceBEmN-XlRaxAAAL',
        user_id: 'vishal_3777',
        token: '019ac93d-d19c4e28-7d21-80a8ee-81',
        game_id: '202',
        operator_id: 'devteam_7071',
        ip: '103.59.75.8',
        '1.251028063:77233831:1': [{
            stake: 10,
            odds: 2.2,
            runningOdds: 2.2,
            category: 1,
            slug: '1.251028063:77233831:1',
            id: '019aca0e-5100ef0d-79c8-8dbbe8-b2',
            profit: 0,
            trade_amount: 12029,
            trdTm: '2025-11-28T10:42:07.232Z',
            updtBl: 12029,
            updtBlAt: '2025-11-28T10:42:07.232Z',
            txn_id: '019aca0e-08f1baa4-7241-879bb0-08'
        }]
    }
}

// event details global inmemory object
let z = {
    '1.251028063:77233831:1': {
        eventName: 'Karnali Yaks v Biratnagar Kings',
        eventDate: '2025-11-28T10:15:00.000Z',
        runnerName: 'Karnali Yaks',
        marketName: 'Match Odds',
    },
    '-1.251025305:90023847:1': {
        eventName: 'Adelaide Strikers W v Sydney Thunder W',
        eventDate: '2025-11-28T08:10:00.000Z',
        runnerName: 'Adelaide Strikers W',
        marketName: 'Who Will Win The Match?',
    }
}

*/
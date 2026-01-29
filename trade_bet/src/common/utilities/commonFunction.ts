import crypto from 'crypto';
import { sendToQueue } from '../queues/amqp';
import { createLogger } from './logger';
import type { IAccountsResult, IPlaceTradeData, IWebhookData, IWalletInfo } from '../interfaces';
import { Socket } from 'socket.io';
const thirdPartyLogger = createLogger('ThirdPartyRequest', 'jsonl');
const failedThirdPartyLogger = createLogger('FailedThirdPartyRequest', 'jsonl');

export const generateUUIDv7 = (): string => {
    const timestamp = Date.now();
    const timeHex = timestamp.toString(16).padStart(12, '0');
    const randomBits = crypto.randomBytes(8).toString('hex').slice(2);
    const uuid = [
        timeHex.slice(0, 8),
        timeHex.slice(8) + randomBits.slice(0, 4),
        '7' + randomBits.slice(4, 7),
        (parseInt(randomBits.slice(7, 8), 16) & 0x3f | 0x80).toString(16) + randomBits.slice(8, 12),
        randomBits.slice(12)
    ];

    return uuid.join('-');
}


export const getUserIP = (socket: Socket): string => {
    const forwardedFor = socket.handshake.headers?.['x-forwarded-for'];
    if (forwardedFor) {
        const ip = typeof forwardedFor == "string" ? forwardedFor.split(',')[0].trim() : forwardedFor[0].split(",")[0].trim();
        if (ip) return ip;
    }
    return socket.handshake.address || '';
};


export const updateBalanceFromAccount = async (data: IPlaceTradeData, key: "CREDIT" | "DEBIT", playerDetails: IWalletInfo): Promise<IAccountsResult> => {
    try {
        const webhookData = await prepareDataForWebhook({ ...data, game_id: playerDetails.game_id }, key);
        if (!webhookData) return { status: false, type: key };

        if (key === 'CREDIT') {
            await sendToQueue('', 'games_cashout', JSON.stringify({ ...webhookData, operatorId: playerDetails.operator_id, token: playerDetails.token }));
            return { status: true, type: key, txn_id: webhookData.txn_id };
        };

        data.txn_id = webhookData.txn_id;
        const sendRequest = await sendRequestToAccounts(webhookData, playerDetails.token);
        if (!sendRequest) return { status: false, type: key };

        return { status: true, type: key, txn_id: data.txn_id };
    } catch (err) {
        console.error(`Err while updating Player's balance is`, err);
        return { status: true, type: key };
    }
}

export const sendRequestToAccounts = async (
    webhookData: IWebhookData,
    token: string
): Promise<boolean> => {
    try {
        const url = process.env.service_base_url;
        if (!url) throw new Error("Service base URL is not defined");

        const requestUrl = `${url}/service/operator/user/balance/v2`;

        // Timeout using AbortController (works in Node fetch & Bun fetch)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(requestUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                token
            },
            body: JSON.stringify(webhookData),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await response.json();

        thirdPartyLogger.info(
            JSON.stringify({
                logId: generateUUIDv7(),
                req: { url: requestUrl, webhookData, token },
                res: data
            })
        );

        if (!data.status) return false;

        return true;

    } catch (err: any) {
        console.error(`Err while sending request to accounts:::`, err?.message);

        failedThirdPartyLogger.error(
            JSON.stringify({
                logId: generateUUIDv7(),
                req: { webhookData, token },
                res: err?.response?.status || err?.message
            })
        );

        return false;
    }
};


export const prepareDataForWebhook = async (tradeObj: IPlaceTradeData, key: "CREDIT" | "DEBIT"): Promise<IWebhookData | false> => {
    try {
        let { id, trade_amount, winning_amount, game_id, user_id, txn_id, ip } = tradeObj;

        const amountFormatted = Number(trade_amount).toFixed(2);
        let baseData: IWebhookData = {
            txn_id: generateUUIDv7(),
            ip,
            game_id,
            user_id
        };

        if (key == 'DEBIT') {
            return {
                ...baseData,
                amount: amountFormatted,
                description: `CALL ${Number(trade_amount).toFixed(2)} for ${process.env.APP_NAME} with reference id ${baseData.txn_id}`,
                txn_type: 0
            }
        }
        else if (key == 'CREDIT') {
            return {
                ...baseData,
                amount: winning_amount,
                txn_ref_id: txn_id,
                description: `RECALL ${Number(winning_amount).toFixed(2)} for ${process.env.APP_NAME} against reference id ${tradeObj.txn_id}`,
                txn_type: 1
            }
        }
        else return baseData;
    } catch (err) {
        console.error(`[ERR] while trying to prepare data for webhook is::`, err);
        return false;
    }
};

export function getBetDelay(betDelay: number | null): number {
    let bet_delay = 0;
    if (!betDelay || isNaN(betDelay)) {
        bet_delay = 6;
    } else {
        bet_delay = Number(betDelay);
    };
    return bet_delay;
}
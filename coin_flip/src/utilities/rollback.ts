import { sendToQueue } from "./amqp";
import { rollBackTransaction } from "./common";
import { updateRollback } from "./db-queries";
import { logError, logRollback } from "./logger";
import { deleteHashField, getAllBetHash, getHashField } from "./redis-connecton";

interface ProcessItemResult {
  status: boolean;
  item: string;
  msg?: string;
}

export const ROLLBACK_CHUNK_SIZE = 10;
export const ROLLBACK_RETRY_DELAY_MS = 10000;
export async function checkForRollBack(): Promise<string> {
  try {
    const keys = await getAllBetHash('BT:*');
    if (!keys || keys.length === 0) {
      return 'No data to Rollback';
    }

    await processInChunksWithRetry(keys);
    return 'Rollback process completed';
  } catch (error) {
    await logError('Error in checkForRollBack', { error });
    return 'Rollback process failed';
  }
}

async function processInChunksWithRetry(data: string[], chunkSize = ROLLBACK_CHUNK_SIZE): Promise<void> {
  const failedKeys: string[] = [];

  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.slice(index, index + chunkSize);
    const results = await Promise.all(chunk.map(async item => processItem(item)));

    for (const result of results) {
      if (result.status) {
        await deleteHashField(result.item);
      } else if (result?.status === false && result?.msg == "Transaction not found") {
        await deleteHashField(result.item);
      }
      else {
        failedKeys.push(result.item);
      }
    }
  }

  if (failedKeys.length > 0) {
    await delay(ROLLBACK_RETRY_DELAY_MS);
    await processInChunksWithRetry(failedKeys, chunkSize);
  }
}


function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processItem(item: string): Promise<ProcessItemResult> {
  try {
    const values = await getHashField(item);
    if (!values) throw new Error('Invalid or missing values in hash');


    if (values.winAmount) {
      const webHookData = {
        amount: values.winAmount,
        txn_id: values.creditTxnId,
        ip: values.ip,
        game_id: values.game_id,
        user_id: values.userId,
        txn_ref_id: values.debitTxnId,
        description: `${values.winAmount} Credited (Server Restart) for Heads And Tails Game for Round Id ${values.matchId}`,
        txn_type: 1,
      };

      await sendToQueue(
        '',
        'games_cashout',
        JSON.stringify({ ...webHookData, operatorId: values.operatorId, token: values.token })
      );

      return { status: true, item };
    }

    const userRollBack = await rollBackTransaction({
      txn_id: values.debitTxnId,
      betAmount: values.betAmount,
      userId: decodeURIComponent(values.userId),
      matchId: values.matchId,
    });

    if (userRollBack && userRollBack.response?.status === true) {
      await updateRollback({
        betTransactionId: values.debitTxnId,
        userId: values.userId,
        matchId: values.matchId,
        resultStatus: 'rollback',
      });
      return { status: userRollBack?.response?.status, item, msg: userRollBack?.response?.msg };
    }

    await logRollback('Rollback failed', { item, userRollBack });
    return { status: userRollBack?.response?.status, item, msg: userRollBack?.response?.msg };
  } catch (error) {
    void logError('Error in processItem', { item, error });
    return { status: false, item };
  }
}

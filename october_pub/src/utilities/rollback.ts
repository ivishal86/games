import config from "../config/config";
import { sendToQueue } from "./amqp";
import { rollBackTransaction } from "./common";
import { updateRollback } from "./db-queries";
import { logError, logRollback, logRollbackRetry } from "./logger";
import { deleteHashField, getAllBetHash, getHashField } from "./redis-connection";

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

let count = 0
async function processInChunksWithRetry(data:string[], chunkSize = ROLLBACK_CHUNK_SIZE) {
 
    let i = 0
    let failedKeys :string[] = []
    while (data.length > 0) {
        console.log(count, "before");
        count++;
        console.log(count, "after");
        console.log("run");
        const chunk = data.splice(i, chunkSize);
        console.log(chunk, "chunks")
        let results = await Promise.all(chunk.map(item => processItem(item)))
        console.log("first")
        console.log(results, "results")
        results.forEach(async (result) => {
            if (result.status === true) {
                const index = chunk.indexOf(result.item);
                //chunk.splice(index, 1);
                await deleteHashField(result.item);
            } else if (result?.status === false && result?.msg == "Transaction not found") {
                await deleteHashField(result?.item);
            } else {
                let el = result.item
                //shift item from data
                // const index = data.indexOf(result.item);
                // data.splice(index, 1);
                //data.push(el)
                failedKeys.push(el)
            }
            console.log(count, "count in rollback");
            console.log(failedKeys, "array in rollback")
 
            const log = { failedKeys, count };
            logRollbackRetry(JSON.stringify(log))
            if (count === config.ROLLBACK_RETRY_LIMIT) {
                await deleteHashField(result.item);
                failedKeys.length = 0
                count = 0
            }
        });
 
    }
 
    if (failedKeys.length > 0) {
 
        await delay(config.RETRY_MILISECONDS)
        processInChunksWithRetry(failedKeys)
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
        user_id: decodeURIComponent(values.userId),
        txn_ref_id: values.debitTxnId,
        description: `${values.winAmount} Credited (Server Restart) for October Pub Game for Round Id ${values.matchId}`,
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

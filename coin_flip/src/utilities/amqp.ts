import client, { Channel } from "amqplib"
import { createLogger, format, transports } from 'winston';
import { logAmqp, logCashoutFail } from "./logger";

const RECONNECT_DELAY = 1000; // 1 second

export const rabbitMQLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  defaultMeta: { service: 'Queue' }, 
  transports: [
    new transports.Console()
  ],
});

let pubChannel: Channel | null = null;
let subChannel: Channel | null = null;
let connected = false;
const { AMQP_CONNECTION_STRING, AMQP_EXCHANGE_NAME } = process.env;
const exchange = AMQP_EXCHANGE_NAME  || "/games/admin";
const connectionString = AMQP_CONNECTION_STRING || "amqp://prashant:GpLK982qXJPUMxetvEnzHy@13.200.181.150:5672";

export const initQueue = async (): Promise<void> => {
    await connect();
}

export const connect = async (): Promise<void> => {
    if (connected && pubChannel && subChannel) return;
    try {
        void logAmqp(`⌛️ Connecting to Rabbit-MQ Server, ${connectionString.split('@')[1]}`);
        const connection = await client.connect(connectionString);
        void logAmqp("✅ Rabbit MQ Connection is ready");
        [pubChannel, subChannel] = await Promise.all([
            connection.createChannel(),
            connection.createChannel()
        ]);
        await pubChannel.assertExchange(exchange, "x-delayed-message", { autoDelete: false, durable: true,  
            arguments: { "x-delayed-type": "direct" } });    
        pubChannel.removeAllListeners('close');
        pubChannel.removeAllListeners('error');
        subChannel.removeAllListeners('close');
        subChannel.removeAllListeners('error');
        pubChannel.on('close', async () => { console.error("pubChannel Closed"); pubChannel = null; connected = false; });
        subChannel.on('close', async () => { 
            console.error("subChannel Closed"); 
            subChannel = null; 
            connected = false; 
            setTimeout(() => initQueue(), RECONNECT_DELAY);
        });
        pubChannel.on('error', async (msg) => { console.error("pubChannel Error", msg); });
        subChannel.on('error', async (msg) => { console.error("subChannel Error", msg); });
        rabbitMQLogger.info("🛸 Created RabbitMQ Channel successfully");
        connected = true;
    } catch (error) {
        rabbitMQLogger.error(error);
        rabbitMQLogger.error("Not connected to MQ Server");
    }
}

export const sendToQueue = async(ex:string, queueName:string, message:string, delay = 0, retries = 0): Promise<void> => {
    try {
        if (!pubChannel) {
            await connect();
        }
        await pubChannel?.assertQueue(queueName, { durable: true });
        await pubChannel?.bindQueue(queueName, exchange, queueName); // This is done for simplicity .
        pubChannel?.publish(exchange, queueName, Buffer.from(message), {
            headers: { "x-delay": delay, "x-retries": retries }, persistent: true
        });
        void logAmqp(`Message sent to ${queueName} queue on exchange ${exchange}`)
        console.log(`Message sent to ${queueName} queue on exchange ${exchange}`);
    } catch (error: unknown) {
        console.log(error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        rabbitMQLogger.error(`Failed to send message to ${queueName} queue on exchange ${exchange}: ${errorMessage}`);
        void logCashoutFail(`Credit transaction fail',${queueName}, ${message}`)
        throw error;
    }
}
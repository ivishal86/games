import amqp, { type Channel, type Options } from "amqplib";
import { createLogger } from "../../common/utilities/logger";
import dotenv from 'dotenv';

dotenv.config();

const rabbitMQLogger = createLogger("Queue");

let pubChannel: Channel | null = null;
let subChannel: Channel | null = null;
let connected = false;

const AMQP_CONNECTION_STRING = process.env.AMQP_CONNECTION_STRING;
const AMQP_EXCHANGE_NAME = process.env.AMQP_EXCHANGE_NAME;

if (!AMQP_CONNECTION_STRING || !AMQP_EXCHANGE_NAME) {
    throw new Error("Environment variables AMQP_CONNECTION_STRING or AMQP_EXCHANGE_NAME are not set.");
}

const exchange = AMQP_EXCHANGE_NAME;

export const initQueue = async (): Promise<void> => {
    await connect();
};

export const connect = async (): Promise<void> => {
    if (connected && pubChannel && subChannel) return;

    try {
        rabbitMQLogger.info(`⌛️ Connecting to Rabbit-MQ Server ${AMQP_CONNECTION_STRING.split("@")[1]}`);
        const connection = await amqp.connect(AMQP_CONNECTION_STRING);

        rabbitMQLogger.info("✅ Rabbit MQ Connection is ready");

        [pubChannel, subChannel] = await Promise.all([
            connection.createChannel(),
            connection.createChannel(),
        ]);

        pubChannel.removeAllListeners("close");
        pubChannel.removeAllListeners("error");
        subChannel.removeAllListeners("close");
        subChannel.removeAllListeners("error");

        pubChannel.on("close", async () => {
            console.error("pubChannel Closed");
            pubChannel = null;
            connected = false;
        });

        subChannel.on("close", async () => {
            console.error("subChannel Closed");
            subChannel = null;
            connected = false;
            setTimeout(() => initQueue(), 1000);
        });

        pubChannel.on("error", async (msg: unknown) => {
            console.error("pubChannel Error", msg);
        });

        subChannel.on("error", async (msg: unknown) => {
            console.error("subChannel Error", msg);
        });

        rabbitMQLogger.info("🛸 Created RabbitMQ Channel successfully");
        connected = true;
    } catch (error: any) {
        rabbitMQLogger.error(error);
        rabbitMQLogger.error("Not connected to MQ Server");
    }
};

export const sendToQueue = async (
    ex: string,
    queueName: string,
    message: string,
    delay: number = 0,
    retries: number = 0
): Promise<void> => {
    try {
        if (!pubChannel || (pubChannel as any).connection?._closing) {
            await connect();
        }

        if (!pubChannel) throw new Error("Publisher channel not initialized");

        await pubChannel.assertExchange(ex || exchange, "x-delayed-message", {
            autoDelete: false,
            durable: true,
            arguments: { "x-delayed-type": "direct" },
        } as Options.AssertExchange);
        await pubChannel.bindQueue(queueName, ex || exchange, queueName); // Binding for simplicity

        pubChannel.publish(
            ex || exchange,
            queueName,
            Buffer.from(message),
            {
                headers: {
                    "x-delay": delay,
                    "x-retries": retries,
                },
                persistent: true,
            } as Options.Publish
        );
        rabbitMQLogger.info(
            `Message sent to ${queueName} queue on exchange ${ex || exchange} with data ${JSON.stringify(message)} and ${delay}ms delay`
        );
    } catch (error: any) {
        console.error(error);
        rabbitMQLogger.error(
            `Failed to send message to ${queueName} queue on exchange ${ex || exchange}: ${error.message}`
        );
        throw error;
    }
};
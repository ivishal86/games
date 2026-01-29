import { queryApi } from "../../../common/database/influxdb";
import type { IInfluxExchange } from "../../../common/interfaces";
import { logEventAndEmitResponse } from "../../../common/utilities/helperFunc";
const { INFLUXDB_BUCKET, INFLUX_MEASUREMENT } = process.env;

async function runInfluxQuery(query: string): Promise<{ err: string } | { [key: string]: IInfluxExchange }> {
    try {
        const exchanges: any[] = [];

        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(query, {
                next(row: any, meta: { toObject: (arg: any) => any; }) {
                    exchanges.push(meta.toObject(row));
                },
                error(err: any) {
                    console.error("[InfluxDB Error]:", err);
                    reject(err);
                },
                complete() {
                    resolve();
                },
            });
        });

        if (!exchanges.length) return { err: "Exchange not found" };
        // 🔄 Group results by (id + _time)
        const groupedResults: Record<string, IInfluxExchange> = {};
        for (const item of exchanges) {
            const key = `${item.id}_${item._time}`;

            groupedResults[key] = groupedResults[key] || {
                id: item.id,
                _time: item._time,
                time_ms: new Date(item._time).getTime()
            };
            (groupedResults[key] as any)[item._field] = item._value;
        }
        return groupedResults;
    } catch (error: any) {
        console.error("[InfluxDB Error]:", error.message);
        return { err: error.message || "Exchange not found" };
    }
}

export const getCurrentExchanges = async (
    slug: string,
    timeInterval: string
): Promise<{ err: string } | { [key: string]: IInfluxExchange }> => {
    const query = `lastRec =
        from(bucket: "${INFLUXDB_BUCKET}")
            |> range(start: -${timeInterval})
            |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
            |> filter(fn: (r) => r.id == "${slug}" and r._field == "status" and r._value == 1)
            |> last()
            |> findRecord(fn: (key) => true, idx: 0)

        from(bucket: "${INFLUXDB_BUCKET}")
            |> range(start: -${timeInterval})
            |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
            |> filter(fn: (r) => r._time == lastRec._time and r.id == "${slug}")
            |> yield()`;
    return await runInfluxQuery(query);
};

export const getLastExchange = async (slug: string, timeinterval: string): Promise<{ err: string } | { [key: string]: IInfluxExchange }> => {
    const query = `
        from(bucket: "${INFLUXDB_BUCKET}")
            |> range(start: -${timeinterval})
            |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
            |> filter(fn: (r) => r.id == "${slug}")
            |> last()
            |> yield()
    `;
    return await runInfluxQuery(query);
}

export const getExchangesByTimeRange = async (
    slug: string,
    startTime: string,
    endTime: string
): Promise<{ err: string } | { [key: string]: IInfluxExchange }> => {
    const query = `
        from(bucket: "${INFLUXDB_BUCKET}")
            |> range(start: time(v: "${startTime}"), stop: time(v: "${endTime}"))
            |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
            |> filter(fn: (r) => r.id == "${slug}")
            |> sort(columns: ["_time"], desc: false)
    `;
    return await runInfluxQuery(query);
};

export const getAggregatedExchangeData = async (
    slug: string,
    timeRange: string,
    interval: string
): Promise<{ err: string } | { [key: string]: IInfluxExchange }> => {
    const query = `
    from(bucket: "${INFLUXDB_BUCKET}")
    |> range(start: -${timeRange}, stop: now())
    |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
    |> filter(fn: (r) => r.id == "${slug}")
    |> aggregateWindow(every: ${interval}, fn: last, createEmpty: false)
    |> sort(columns: ["_time"])
    |> yield(name: "1m_interval_data")
    `;
    return await runInfluxQuery(query);
};

export async function getExchange(sId: string, exchangeSlug: string, exchangeInterval: string, payload: string[], from: "place" | "exit") {
    try {
        let groupedResults = {};
        if (from == "place") {
            groupedResults = await getLastExchange(exchangeSlug, exchangeInterval);
        } else if (from == "exit") {
            groupedResults = await getCurrentExchanges(exchangeSlug, exchangeInterval);
        }

        if (!groupedResults || "err" in groupedResults || !Object.values(groupedResults).length) {
            const errMsg = (groupedResults as any)?.err ?? "Exchange not found";
            await logEventAndEmitResponse(sId, "trade", payload, errMsg);
            return;
        }

        const validExchanges = Object.values(groupedResults)
            .filter((e: any) => e.odds !== undefined)
            .sort((a: any, b: any) => Number(b.time_ms) - Number(a.time_ms));

        return validExchanges[0];
    } catch (error: any) {
        console.error("Error in getExchange:", error.message);
    }
};
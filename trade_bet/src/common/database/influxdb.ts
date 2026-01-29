import { InfluxDB } from '@influxdata/influxdb-client';
const { INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET } = process.env;

export const influxDB = new InfluxDB({
    url: INFLUXDB_URL || "http://localhost:8086",
    token: INFLUXDB_TOKEN
});
export const writeApi = influxDB.getWriteApi(
    INFLUXDB_ORG || "myorg",
    INFLUXDB_BUCKET || "trade-trade",
    'ms'
);
export const queryApi = influxDB.getQueryApi(INFLUXDB_ORG || "myorg");
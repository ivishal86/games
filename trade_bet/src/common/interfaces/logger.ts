export type ILogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ILogEntry {
    time: number;
    level: ILogLevel;
    name: string;
    msg: string;
};
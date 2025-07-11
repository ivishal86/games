import config from "../config/config";

export enum RiskLevel {
  EASY = 1,
  MEDIUM = 2,
  HARD = 3,
}
export const MULTIPLIERS: Record<RiskLevel, number[]> = {
  [RiskLevel.EASY]: config.multipliers.EASY,
  [RiskLevel.MEDIUM]: config.multipliers.MEDIUM,
  [RiskLevel.HARD]: config.multipliers.HARD,
};;

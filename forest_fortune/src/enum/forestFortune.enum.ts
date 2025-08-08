import config from "../config/config";

export enum RiskLevel {
  EASY = 1,
  MEDIUM = 2,
  HARD = 3,
}

const shuffleArray = (array: number[]): number[] => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

export const gameMultipliers: Record<RiskLevel, number[]> = {
  [RiskLevel.EASY]: config.multipliers.EASY,
  [RiskLevel.MEDIUM]: config.multipliers.MEDIUM,
  [RiskLevel.HARD]: config.multipliers.HARD,
};

export const MULTIPLIERS: Record<RiskLevel, number[][]> = {
  [RiskLevel.EASY]: [
    shuffleArray([...Array(11).fill(0.2), ...Array(9).fill(2)]),
    shuffleArray([...Array(41).fill(0.2), ...Array(9).fill(5)]),
    shuffleArray([...Array(120).fill(0.2), ...Array(9).fill(10)])
  ],
  [RiskLevel.MEDIUM]: [
    shuffleArray([...Array(7).fill(0.1), ...Array(3).fill(3)]),
    shuffleArray([...Array(91).fill(0.1), ...Array(9).fill(10)]),
    shuffleArray([...Array(491).fill(0.1), ...Array(9).fill(50)])
  ],
  [RiskLevel.HARD]: [
    shuffleArray([...Array(91).fill(0), ...Array(9).fill(10)]),
    shuffleArray([...Array(991).fill(0), ...Array(9).fill(100)]),
    shuffleArray([...Array(9991).fill(0), ...Array(9).fill(1000)])
  ],
};
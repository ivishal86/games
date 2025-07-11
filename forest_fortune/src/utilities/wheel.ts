import { MULTIPLIERS, RiskLevel } from "../enum/forestFortune.enum";

export function getMultipliers(risk: RiskLevel, count: number): number[] {
  const options = MULTIPLIERS[risk];

  return Array.from({ length: count }, () => {
    const randomIndex = Math.floor(Math.random() * options.length);
    return options[randomIndex];
  });
}



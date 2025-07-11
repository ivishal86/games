import { EVENT_TYPES } from './events';

export interface EventContract {
  [EVENT_TYPES.gameService]: {
    pickedNumber: number;
    betAmount: number;
  };

  [EVENT_TYPES.SPIN_RESULT]: {
    result: 'win' | 'lose';
    multiplier: number[];
    wallet: number;
    winAmount: number;
  };

  [EVENT_TYPES.info]: {
    user_id: string;
    use_id: string;
    operatorId: string;
  };

  [EVENT_TYPES.Error]: string;
}

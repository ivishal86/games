export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export type Value =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  value: Value;
  valueRank: number; // Used for comparison (e.g. 2 = 2, J = 11, Q = 12, K = 13, A = 14)
  rountId?:string;
}
export interface ResultDraw {
  homeCard: Card;
  awayCard: Card;
  result: string;
}
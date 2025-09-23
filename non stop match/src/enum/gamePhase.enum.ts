export enum GamePhase {
  BET = 'BET',                  // 10s: players choose their bets (UI selection)
  BET_ACCEPTANCE = 'ACCEPTANCE',// 1s: validate bets, debit, store
  RESULT = 'RESULT',            // 1s: draw cards and decide outcome
  WIN_HANDLING = 'WIN_HANDLING' ,// 1s: calculate winnings, DB insertion, emit wins
}
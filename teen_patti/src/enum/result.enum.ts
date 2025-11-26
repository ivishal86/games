export enum ResultEnum{
    win="win",
    lose="lose",
    rollback="rollback"
}

export enum MainOutcome { DEALER = 'DEALER', PLAYER = 'PLAYER', SPLIT = 'SPLIT' }

export enum HandRank {
HIGH_CARD = 1,
PAIR = 2,
FLUSH = 3,
SEQUENCE = 4,
PURE_SEQUENCE = 5,
TRAIL = 6,
}
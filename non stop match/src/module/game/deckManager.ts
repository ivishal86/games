import { Server } from 'socket.io';
import { Card, Suit, Value } from '../../interface/card.interface';
import config from '../../config/config';
import { getRandomInt } from '../../utilities/helper';
import { emitMessage } from '../../utilities/common';
import { redisClient } from '../../utilities/redis-connecton';
function createDeckManager(io: Server, gameRoom: string) {
  let deck: Card[] = [];
  let deckHistory: Card[] = [];
  let burnedCards: Card[] = [];
  let cutCardReached = false;
  const roomId = String(config.ROOMID)
  const CUT_CARD_FROM_END = 150;
  let cutCardIndexForUser=0
  let cutCardIndex = 0;

  // const room= gameRoom || config.ROOMID || 'non_stop_match';
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values: Value[] = [
    '2', '3', '4', '5', '6', '7', '8', '9', '10',
    'J', 'Q', 'K', 'A'
  ];

  function getCardValue(value: Value): number {
    if (value === 'A') return 14;
    if (value === 'K') return 13;
    if (value === 'Q') return 12;
    if (value === 'J') return 11;
    return parseInt(value);
  }


  function generateDeck(): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < 8; i++) { // 8 decks
      for (const suit of suits) {
        for (const value of values) {
          cards.push({ suit, value, valueRank: getCardValue(value) });
        }
      }
    }
    return cards;
  }
  function shuffleNewDeck(): void {
    deck = generateDeck();
    // Shuffle logic...
    void redisClient.ltrim("game:roundHistory", 1, 0); 
    deckHistory.splice(0);
    cutCardIndexForUser=0;
    cutCardReached = false;
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = getRandomInt(0, i);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    burnCards();
    cutCardIndex = 150;
    cutCardIndexForUser=CUT_CARD_FROM_END - cutCardIndexForUser;
    if (cutCardIndex < 0) cutCardIndex = 0;
    if (io && roomId) {
      emitMessage({ io, room: roomId }, 'DECK_SHUFFLED', {
          message: 'Deck reshuffled',
          cutCardIndex:deck.length - cutCardIndexForUser,
          upcomingCards: deck.length,
      });
    }
    console.log(deck.length, 'upcoming--------')
    console.log(`🃏 New deck shuffled. Cut card index: ${cutCardIndexForUser}`);
  }
  function burnCards(): void {
    const firstCard = deck.shift();
    if (!firstCard) return;

    let burnCount = 1;
    if (firstCard.valueRank >= 2 && firstCard.valueRank <= 10) burnCount = firstCard.valueRank;
    else if (['A', 'J', 'Q', 'K'].includes(firstCard.value)) burnCount = 10;

    burnedCards = deck.splice(0, burnCount)
    // 📡 Notify frontend about burned cards
    console.log(`🔥 Burned ${burnCount} cards: ${burnedCards.map(c => `${c.value} of ${c.suit}`).join(', ')}`),
      io.to(gameRoom).emit('message', {
        type: 'BURN_CARD_DRAWN',
        data: {
          burnCard: firstCard,
          burnedCards,
          burnCount,
        },
      });
  }

  function drawCard(): Card {
    if (deck.length === 0) {
      shuffleNewDeck();
    }

    const card = deck.shift();
    if (!card) throw new Error('Deck is empty');
    console.log(deck.length, '--------------------------------------------')
    deckHistory.unshift(card)

    // 🛑 Check for cut card
    if (!cutCardReached && deck.length <= cutCardIndex) {
      cutCardReached = true;
      console.log('Cut card drawn', card)
      // 👇 Emit that cut card is reached
      io?.to(gameRoom).emit('message', {
        type: 'CUT_CARD_REACHED',
        data: {
          card,
          message: 'Cut card drawn. Will reshuffle next round.',
          remainingCards: deck.length,
          cutCardIndex: deck.length-cutCardIndexForUser,
        }
      });

      // 🚫 Don't use this card in game logic, return replacement card instead
      return drawCard();
    }

    return card;
  }
  function getDeckState(): Record<string,number>{
    return {
      remainingCards: deck.length,
      cutCardIndex: deck.length - cutCardIndexForUser-1,
    };
  }
  function getLastCards(){
    return deckHistory;
  }
  function hasCutCardBeenReached(): boolean {
    return cutCardReached;
  }

  function resetCutCardFlag(): void {
    cutCardReached = false;
  }
  function isDeckEmpty(): boolean {
    return deck.length === 0;
  }
  function endRound(): void {
    const remaining = deck.length;

    if (remaining <= cutCardIndex && !cutCardReached) {
      cutCardReached = true; // <- will be handled in next round
      console.log('🪓 Cut card limit reached. Triggering reshuffle.');
    }
  }
  function resetLastcards () : void {
    deckHistory.splice(0)
  }
  // Return exposed API
  return {
    shuffleNewDeck,
    drawCard,
    endRound,
    getDeckLength: (): Number => deck.length,
    getBurnedCards: (): Card[] => burnedCards,
    hasCutCardBeenReached,
    resetCutCardFlag,
    isDeckEmpty,
    getDeckState,
    getLastCards,
    resetLastcards
  };
}
export default createDeckManager;

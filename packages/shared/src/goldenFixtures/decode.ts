import { type Card, Rank, Suit } from '../cards';
import { type Combo, ComboType } from '../combinations';
import { type GameState, Phase } from '../gameState';

const RANK_BY_NAME: Readonly<Record<string, Rank>> = {
  DOG: Rank.Dog,
  MAHJONG: Rank.Mahjong,
  TWO: Rank.Two,
  THREE: Rank.Three,
  FOUR: Rank.Four,
  FIVE: Rank.Five,
  SIX: Rank.Six,
  SEVEN: Rank.Seven,
  EIGHT: Rank.Eight,
  NINE: Rank.Nine,
  TEN: Rank.Ten,
  JACK: Rank.Jack,
  QUEEN: Rank.Queen,
  KING: Rank.King,
  ACE: Rank.Ace,
  PHOENIX: Rank.Phoenix,
  DRAGON: Rank.Dragon,
};

const SUIT_BY_NAME: Readonly<Record<string, Suit>> = {
  SWORD: Suit.Sword,
  PAGODA: Suit.Pagoda,
  JADE: Suit.Jade,
  STAR: Suit.Star,
  SPECIAL: Suit.Special,
};

const PHASE_BY_NAME: Readonly<Record<string, Phase>> = {
  LARGE_TICHU: Phase.LargeTichu,
  EXCHANGE: Phase.Exchange,
  PLAYING: Phase.Playing,
  ROUND_OVER: Phase.RoundOver,
};

export interface FixtureCard {
  readonly rank: string;
  readonly suit: string;
}

export interface FixtureCombo {
  readonly comboType: string;
  readonly cards: readonly FixtureCard[];
  readonly length: number;
  readonly rankStrength: number;
  readonly isLonePhoenix: boolean;
}

export interface FixtureState {
  readonly hands: readonly (readonly FixtureCard[])[];
  readonly pendingFinalCards: readonly (readonly FixtureCard[])[];
  readonly phase: string;
  readonly currentPlayer: number;
  readonly trickLeader: number;
  readonly trickCards: readonly FixtureCard[];
  readonly currentBest: FixtureCombo | null;
  readonly currentStrength: number;
  readonly lastPlayerToAct: number | null;
  readonly passesInARow: number;
  readonly finishedOrder: readonly number[];
  readonly collectedTricks: readonly (readonly FixtureCard[])[];
  readonly largeTichuCalls: readonly (boolean | null)[];
  readonly tichuCalls: readonly boolean[];
  readonly mahjongWish: string | null;
}

export function cardFromFixture(json: FixtureCard): Card {
  return { rank: RANK_BY_NAME[json.rank]!, suit: SUIT_BY_NAME[json.suit]! };
}

export function cardsFromFixture(json: readonly FixtureCard[]): Card[] {
  return json.map(cardFromFixture);
}

export function comboFromFixture(json: FixtureCombo | null): Combo | null {
  if (json === null) return null;
  return {
    comboType: json.comboType as ComboType,
    cards: cardsFromFixture(json.cards),
    length: json.length,
    rankStrength: json.rankStrength,
    isLonePhoenix: json.isLonePhoenix,
  };
}

export function stateFromFixture(json: FixtureState): GameState {
  return {
    hands: json.hands.map(cardsFromFixture),
    pendingFinalCards: json.pendingFinalCards.map(cardsFromFixture),
    phase: PHASE_BY_NAME[json.phase]!,
    currentPlayer: json.currentPlayer,
    trickLeader: json.trickLeader,
    trickCards: cardsFromFixture(json.trickCards),
    currentBest: comboFromFixture(json.currentBest),
    currentStrength: json.currentStrength,
    lastPlayerToAct: json.lastPlayerToAct,
    passesInARow: json.passesInARow,
    finishedOrder: json.finishedOrder,
    collectedTricks: json.collectedTricks.map(cardsFromFixture),
    largeTichuCalls: json.largeTichuCalls,
    tichuCalls: json.tichuCalls,
    mahjongWish: json.mahjongWish === null ? null : RANK_BY_NAME[json.mahjongWish]!,
  };
}

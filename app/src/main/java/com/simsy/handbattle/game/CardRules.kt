package com.simsy.handbattle.game

/** Stable IDs identify cards; rules text remains separate from executable effect data. */
data class CardDefinition(
    val id: String,
    val name: String,
    val kind: CardKind,
    val attack: Int? = null,
    val nonEffectText: String = "",
    val effectText: String = "",
    val effects: List<CardEffectDefinition> = emptyList(),
)

enum class CardKind {
    MONSTER,
    NORMAL,
    MAGIC,
    TRAP,
    FIELD,
}

/** Metadata for one numbered card effect. Its executable resolution is added in the engine layer. */
data class CardEffectDefinition(
    val number: Int,
    val timing: EffectTiming,
)

enum class EffectTiming {
    ACTIVATED,
    QUICK,
    TRIGGER,
    CONTINUOUS,
    REPLACEMENT,
}

enum class PlayerSeat {
    FIRST,
    SECOND,
}

enum class TurnPhase {
    DRAW,
    DEPLOY,
    BATTLE,
    END,
}

data class DeckList(
    val mainDeck: List<CardDefinition>,
    val keyDeck: List<CardDefinition> = emptyList(),
)

sealed interface DeckIssue {
    data class MainDeckSize(val actual: Int) : DeckIssue
    data class TooManyCopies(val cardId: String, val count: Int) : DeckIssue
    data class KeyDeckSize(val actual: Int) : DeckIssue
    data class DuplicateKeyCard(val cardId: String) : DeckIssue
}

object HandBattleRules {
    const val MAIN_DECK_MIN = 40
    const val MAIN_DECK_MAX = 60
    const val COPIES_PER_CARD_MAX = 4
    const val KEY_DECK_MAX = 5
    const val FIRST_PLAYER_OPENING_HAND = 6
    const val SECOND_PLAYER_OPENING_HAND = 7
    const val WINNING_OPPONENT_HAND_SIZE = 0

    val phaseOrder = listOf(TurnPhase.DRAW, TurnPhase.DEPLOY, TurnPhase.BATTLE, TurnPhase.END)

    fun validateDeck(deck: DeckList): List<DeckIssue> = buildList {
        if (deck.mainDeck.size !in MAIN_DECK_MIN..MAIN_DECK_MAX) {
            add(DeckIssue.MainDeckSize(deck.mainDeck.size))
        }

        deck.mainDeck.groupingBy(CardDefinition::id).eachCount().forEach { (cardId, count) ->
            if (count > COPIES_PER_CARD_MAX) add(DeckIssue.TooManyCopies(cardId, count))
        }

        if (deck.keyDeck.size > KEY_DECK_MAX) add(DeckIssue.KeyDeckSize(deck.keyDeck.size))

        deck.keyDeck.groupingBy(CardDefinition::id).eachCount()
            .filterValues { it > 1 }
            .keys
            .forEach { add(DeckIssue.DuplicateKeyCard(it)) }
    }

    fun openingHandSize(isFirstPlayer: Boolean): Int =
        if (isFirstPlayer) FIRST_PLAYER_OPENING_HAND else SECOND_PLAYER_OPENING_HAND

    fun drawsAtTurnStart(seat: PlayerSeat, turnNumber: Int): Boolean =
        seat == PlayerSeat.SECOND || turnNumber > 1

    fun hasWonByEmptyingOpponentHand(opponentHandSize: Int): Boolean =
        opponentHandSize == WINNING_OPPONENT_HAND_SIZE
}

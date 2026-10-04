package com.simsy.handbattle.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HandBattleRulesTest {
    @Test
    fun legalMainDeckAndKeyDeckHaveNoIssues() {
        val deck = DeckList(
            mainDeck = List(40) { index -> card("card-$index") },
            keyDeck = listOf(card("key-a"), card("key-b")),
        )

        assertTrue(HandBattleRules.validateDeck(deck).isEmpty())
    }

    @Test
    fun mainDeckMustContainBetweenFortyAndSixtyCards() {
        val issues = HandBattleRules.validateDeck(DeckList(mainDeck = List(39) { card("card-$it") }))

        assertEquals(listOf(DeckIssue.MainDeckSize(39)), issues)
    }

    @Test
    fun mainDeckAllowsAtMostFourCopies() {
        val deck = DeckList(mainDeck = List(40) { index -> card(if (index < 5) "same" else "other-$index") })

        assertTrue(HandBattleRules.validateDeck(deck).contains(DeckIssue.TooManyCopies("same", 5)))
    }

    @Test
    fun keyDeckAllowsAnyNumberOfUniqueCardsButOnlyOneCopyOfEach() {
        val manyUnique = DeckList(mainDeck = List(40) { card("main-$it") }, keyDeck = List(11) { card("key-$it") })
        val duplicate = DeckList(mainDeck = List(40) { card("main-$it") }, keyDeck = listOf(card("key"), card("key")))

        assertTrue(HandBattleRules.validateDeck(manyUnique).isEmpty())
        assertTrue(HandBattleRules.validateDeck(duplicate).contains(DeckIssue.DuplicateKeyCard("key")))
    }

    @Test
    fun openingHandsMatchTheCurrentRule() {
        assertEquals(6, HandBattleRules.openingHandSize(isFirstPlayer = true))
        assertEquals(7, HandBattleRules.openingHandSize(isFirstPlayer = false))
    }

    @Test
    fun turnPhasesAndFirstTurnDrawMatchTheCurrentRule() {
        assertEquals(listOf(TurnPhase.DRAW, TurnPhase.DEPLOY, TurnPhase.BATTLE, TurnPhase.END), HandBattleRules.phaseOrder)
        assertEquals(false, HandBattleRules.drawsAtTurnStart(PlayerSeat.FIRST, turnNumber = 1))
        assertEquals(true, HandBattleRules.drawsAtTurnStart(PlayerSeat.SECOND, turnNumber = 1))
        assertEquals(true, HandBattleRules.drawsAtTurnStart(PlayerSeat.FIRST, turnNumber = 2))
    }

    @Test
    fun winningMeansTheOpponentsHandIsEmpty() {
        assertEquals(true, HandBattleRules.hasWonByEmptyingOpponentHand(0))
        assertEquals(false, HandBattleRules.hasWonByEmptyingOpponentHand(1))
    }

    private fun card(id: String) = CardDefinition(id = id, name = id, kind = CardKind.MONSTER, attack = 0)
}

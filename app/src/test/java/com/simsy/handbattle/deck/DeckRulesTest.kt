package com.simsy.handbattle.deck

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckRulesTest {
    private val cards = buildList {
        repeat(18) { index -> add(card("main-$index", "main")) }
        repeat(11) { index -> add(card("key-$index", "key")) }
    }

    @Test
    fun defaultDeckUsesThreeCopiesOfEachMainCardAndTenKeyCards() {
        val deck = DeckRules.starterDeck(cards)

        assertEquals(54, deck.main.size)
        assertEquals(10, deck.key.size)
        assertTrue(DeckRules.validate(deck, cards).isEmpty())
    }

    @Test
    fun defaultDeckStaysLegalWhenMoreThemeCardsAreAdded() {
        val expandedCatalog = cards + List(14) { index -> card("new-theme-$index", "main") }

        val deck = DeckRules.starterDeck(expandedCatalog)

        assertEquals(54, deck.main.size)
        assertTrue(DeckRules.validate(deck, expandedCatalog).isEmpty())
    }

    @Test
    fun mainDeckMustContainFortyToSixtyCardsAndAllowsFourCopies() {
        val fortyCards = cards.filter { it.deck == "main" }.take(10).flatMap { card -> List(4) { card.id } }
        val sixtyCards = cards.filter { it.deck == "main" }.take(15).flatMap { card -> List(4) { card.id } }

        assertTrue(DeckRules.validate(PlayerDeck(fortyCards, emptyList()), cards).isEmpty())
        assertTrue(DeckRules.validate(PlayerDeck(sixtyCards, emptyList()), cards).isEmpty())
        assertTrue(DeckRules.validate(PlayerDeck(fortyCards.drop(1), emptyList()), cards).isNotEmpty())
        assertTrue(DeckRules.validate(PlayerDeck(fortyCards + fortyCards.first(), emptyList()), cards).isNotEmpty())
    }

    @Test
    fun keyDeckAllowsUpToTenDifferentCardsAndOnlyOneCopyOfEach() {
        val keys = cards.filter { it.deck == "key" }.map { it.id }

        assertTrue(DeckRules.validate(PlayerDeck(List(40) { "main-${it % 10}" }, keys.take(10)), cards).isEmpty())
        assertFalse(DeckRules.validate(PlayerDeck(List(40) { "main-${it % 10}" }, keys), cards).isEmpty())
        assertFalse(DeckRules.validate(PlayerDeck(List(40) { "main-${it % 10}" }, keys + keys.first()), cards).isEmpty())
    }

    @Test
    fun cardCannotBePlacedInTheOtherDeckType() {
        val mainCards = cards.filter { it.deck == "main" }.take(10).flatMap { card -> List(4) { card.id } }

        assertFalse(DeckRules.validate(PlayerDeck(mainCards + "key-0", emptyList()), cards).isEmpty())
        assertFalse(DeckRules.validate(PlayerDeck(mainCards, listOf("main-0")), cards).isEmpty())
    }

    private fun card(id: String, deck: String) = DeckCard(
        id = id,
        name = id,
        type = "monster",
        deck = deck,
        attack = 1,
        description = "Effect text",
    )
}

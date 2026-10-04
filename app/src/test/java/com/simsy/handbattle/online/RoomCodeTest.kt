package com.simsy.handbattle.online

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoomCodeTest {
    @Test
    fun acceptsExactlyFourDigitsAndPreservesLeadingZeroes() {
        assertEquals("0427", RoomCode.parse("0427")?.value)
    }

    @Test
    fun rejectsWrongLengthAndNonNumericCodes() {
        assertNull(RoomCode.parse("427"))
        assertNull(RoomCode.parse("04270"))
        assertNull(RoomCode.parse("04A7"))
        assertNull(RoomCode.parse("０427"))
    }
}

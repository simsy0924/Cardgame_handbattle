package com.simsy.handbattle.online

/** Four numeric digits used to invite an opponent to a private online room. */
@JvmInline
value class RoomCode private constructor(val value: String) {
    companion object {
        const val LENGTH = 4

        fun parse(value: String): RoomCode? =
            if (value.length == LENGTH && value.all { it in '0'..'9' }) RoomCode(value) else null
    }
}

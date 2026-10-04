package com.simsy.handbattle

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.simsy.handbattle.deck.DeckCardCatalog
import com.simsy.handbattle.deck.DeckRules
import com.simsy.handbattle.deck.DeckStore
import com.simsy.handbattle.ai.AiDuelApi
import com.simsy.handbattle.ai.AiDuelDeck
import com.simsy.handbattle.ai.AiDuelMatch
import com.simsy.handbattle.ai.AiDuelSession
import com.simsy.handbattle.ai.AiDuelStore
import com.simsy.handbattle.deck.PlayerDeck
import com.simsy.handbattle.online.DuelActionRequest
import com.simsy.handbattle.online.RoomApi
import com.simsy.handbattle.online.RoomApiException
import com.simsy.handbattle.online.RoomCode
import com.simsy.handbattle.online.RoomSession
import com.simsy.handbattle.online.RoomSessionResult
import com.simsy.handbattle.online.RoomSessionStore
import com.simsy.handbattle.online.RoomSnapshot
import okhttp3.WebSocket
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Background = Color(0xFF101218)
private val Panel = Color(0xFF1A1E28)
private val Accent = Color(0xFF7DE0C3)
private val Muted = Color(0xFF9AA3B4)

class MainActivity : ComponentActivity() {
    private val credentialManager by lazy { CredentialManager.create(this) }

    private var firebaseAuth: FirebaseAuth? = null
    private var authStateListener: FirebaseAuth.AuthStateListener? = null
    private var currentUser by mutableStateOf<FirebaseUser?>(null)
    private var googleClientId = ""
    private var firebaseSetupMessage by mutableStateOf("")
    private var statusMessage by mutableStateOf("")
    private var isBusy by mutableStateOf(false)
    private var isDeckEditorOpen by mutableStateOf(false)
    private var isAiDeckEditorOpen by mutableStateOf(false)
    private var isAiDuelSetupOpen by mutableStateOf(false)
    private var playerDeck by mutableStateOf(PlayerDeck(emptyList(), emptyList()))
    private var aiDuelDeck by mutableStateOf<AiDuelDeck?>(null)
    private var aiDuelSession by mutableStateOf<AiDuelSession?>(null)
    private var aiDuelMatch by mutableStateOf<AiDuelMatch?>(null)
    private var aiDuelConnectionStatus by mutableStateOf("연결 안 됨")
    private var aiDuelStatusMessage by mutableStateOf("")
    private var aiDuelBusy by mutableStateOf(false)
    private var aiDuelRefreshing by mutableStateOf(false)
    private var roomSession by mutableStateOf<RoomSession?>(null)
    private var roomSnapshot by mutableStateOf<RoomSnapshot?>(null)
    private var roomConnectionStatus by mutableStateOf("연결 안 됨")
    private var roomActionBusy by mutableStateOf(false)
    private var isRoomConnecting by mutableStateOf(false)
    private var roomStream: WebSocket? = null
    private var roomStreamGeneration = 0
    private var roomFlowGeneration = 0
    private var aiDuelStartGeneration = 0
    private val roomSessionStore by lazy { RoomSessionStore(applicationContext) }
    private val deckCardCatalog by lazy { DeckCardCatalog.load(applicationContext) }
    private val deckStore by lazy { DeckStore(applicationContext) }
    private val aiDuelStore by lazy { AiDuelStore(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        roomSession = roomSessionStore.load()
        aiDuelSession = aiDuelStore.load()
        aiDuelDeck = aiDuelStore.loadDeck()
        if (aiDuelSession != null) aiDuelConnectionStatus = "대전 상태 불러오는 중…"
        playerDeck = deckStore.load(deckCardCatalog)
        if (roomSession != null) roomConnectionStatus = "대기실 연결 복구 중…"
        configureFirebase()
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Background) {
                    val activeRoomSession = roomSession
                    val activeAiDuelSession = aiDuelSession
                    BackHandler(
                        enabled = isDeckEditorOpen || isAiDeckEditorOpen ||
                            activeRoomSession != null || activeAiDuelSession != null || isAiDuelSetupOpen ||
                            (isBusy && activeRoomSession == null),
                    ) {
                        when {
                            isAiDeckEditorOpen -> isAiDeckEditorOpen = false
                            isDeckEditorOpen -> isDeckEditorOpen = false
                            activeRoomSession != null -> leaveRoom()
                            activeAiDuelSession != null -> leaveAiDuel()
                            isAiDuelSetupOpen -> closeAiDuelSetup()
                            isBusy -> cancelRoomRequest()
                        }
                    }
                    if (isDeckEditorOpen) {
                        DeckEditorScreen(
                            cards = deckCardCatalog,
                            initialDeck = playerDeck,
                            onSave = ::saveDeck,
                            onCancel = { isDeckEditorOpen = false },
                        )
                    } else if (isAiDeckEditorOpen) {
                        DeckEditorScreen(
                            cards = deckCardCatalog,
                            initialDeck = aiDuelDeck?.cards ?: PlayerDeck(emptyList(), emptyList()),
                            onSave = ::saveAiDuelDeck,
                            onCancel = { isAiDeckEditorOpen = false },
                            title = "AI 덱 편집",
                        )
                    } else if (activeRoomSession != null) {
                        val activeSnapshot = roomSnapshot
                        if (activeSnapshot != null &&
                            (activeSnapshot.phase == "playing" || activeSnapshot.phase == "finished")
                        ) {
                            DuelScreen(
                                session = activeRoomSession,
                                snapshot = activeSnapshot,
                                connectionStatus = roomConnectionStatus,
                                statusMessage = statusMessage,
                                isBusy = isBusy || roomActionBusy || isRoomConnecting,
                                onAction = ::submitGameAction,
                                cards = deckCardCatalog,
                                onLeave = ::leaveRoom,
                            )
                        } else {
                            RoomLobbyScreen(
                                session = activeRoomSession,
                                snapshot = activeSnapshot,
                                connectionStatus = roomConnectionStatus,
                                statusMessage = statusMessage,
                                isSignedIn = currentUser != null,
                                isBusy = isBusy || roomActionBusy || isRoomConnecting,
                                deckSummary = deckSummary(),
                                deckLegal = DeckRules.validate(playerDeck, deckCardCatalog).isEmpty(),
                                onSignIn = ::signInWithGoogle,
                                onReadyChange = ::setReady,
                                onEditDeck = ::openDeckEditor,
                                onReconnect = ::reconnectRoom,
                                onLeave = ::leaveRoom,
                            )
                        }
                    } else if (activeAiDuelSession != null) {
                        AiDuelScreen(
                            session = activeAiDuelSession,
                            cards = deckCardCatalog,
                            match = aiDuelMatch,
                            connectionStatus = aiDuelConnectionStatus,
                            statusMessage = aiDuelStatusMessage,
                            isBusy = aiDuelBusy,
                            onAction = ::submitAiDuelAction,
                            onRefresh = ::refreshAiDuel,
                            onLeave = ::leaveAiDuel,
                        )
                    } else if (isAiDuelSetupOpen) {
                        AiDuelSetupScreen(
                            cards = deckCardCatalog,
                            humanDeck = playerDeck,
                            aiDeck = aiDuelDeck,
                            isBusy = aiDuelBusy,
                            statusMessage = aiDuelStatusMessage,
                            onBack = ::closeAiDuelSetup,
                            onEditAiDeck = { isAiDeckEditorOpen = true },
                            onStart = ::startAiDuel,
                        )
                    } else {
                        OnlineStartScreen(
                        currentUser = currentUser,
                        signInEnabled = firebaseAuth != null && googleClientId.isNotBlank() && !isBusy,
                        roomActionsEnabled = currentUser != null && !isBusy,
                        isBusy = isBusy,
                        firebaseSetupMessage = firebaseSetupMessage,
                        statusMessage = statusMessage,
                        roomSession = roomSession,
                        deckSummary = deckSummary(),
                        onEditDeck = ::openDeckEditor,
                        onAiDuel = {
                            aiDuelStatusMessage = ""
                            isAiDuelSetupOpen = true
                        },
                        onSignIn = ::signInWithGoogle,
                        onSignOut = ::signOut,
                        onCreateRoom = ::createRoom,
                        onJoinRoom = ::joinRoom,
                        )
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        authStateListener?.let { listener -> firebaseAuth?.addAuthStateListener(listener) }
        if (firebaseAuth?.currentUser != null && roomSession != null) {
            reconnectRoom()
        }
    }

    override fun onStop() {
        authStateListener?.let { listener -> firebaseAuth?.removeAuthStateListener(listener) }
        super.onStop()
    }

    override fun onDestroy() {
        closeRoomStream()
        super.onDestroy()
    }

    private fun configureFirebase() {
        val app = FirebaseApp.initializeApp(applicationContext)
        when {
            app == null -> {
                firebaseSetupMessage = "Firebase 콘솔에서 Android 앱을 등록하고 google-services.json을 app 폴더에 추가하세요."
                statusMessage = firebaseSetupMessage
                return
            }
            app.options.projectId != BuildConfig.FIREBASE_PROJECT_ID -> {
                firebaseSetupMessage = "Firebase 프로젝트 ID가 게임 서버 설정과 다릅니다. cardgame-1b151 프로젝트의 앱 설정 파일을 사용하세요."
                statusMessage = firebaseSetupMessage
                return
            }
        }

        firebaseAuth = FirebaseAuth.getInstance(app)
        currentUser = firebaseAuth?.currentUser
        authStateListener = FirebaseAuth.AuthStateListener { auth ->
            currentUser = auth.currentUser
            if (currentUser != null && roomSession != null && roomStream == null) reconnectRoom()
        }

        val clientIdResource = resources.getIdentifier("default_web_client_id", "string", packageName)
        googleClientId = if (clientIdResource == 0) "" else getString(clientIdResource)
        firebaseSetupMessage = if (googleClientId.isBlank()) {
            "Google 로그인 설정을 마친 뒤 google-services.json을 다시 다운로드하세요."
        } else {
            "Google 계정으로 로그인한 뒤 방을 만들거나 참가할 수 있어요."
        }
        statusMessage = firebaseSetupMessage
    }

    private fun signInWithGoogle() {
        val auth = firebaseAuth
        if (auth == null || googleClientId.isBlank()) {
            statusMessage = firebaseSetupMessage
            return
        }

        isBusy = true
        lifecycleScope.launch {
            try {
                // This is a button-triggered login, so use the explicit Google sign-in
                // option. It also avoids a Credential Manager bottom-sheet issue seen on
                // some Android devices with multiple Google accounts.
                val googleOption = GetSignInWithGoogleOption.Builder(googleClientId).build()
                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(googleOption)
                    .build()
                val result = credentialManager.getCredential(this@MainActivity, request)
                val credential = result.credential
                if (credential !is CustomCredential ||
                    credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    throw IOException("Google 로그인 정보를 가져오지 못했습니다.")
                }

                val googleIdToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
                auth.signInWithCredential(GoogleAuthProvider.getCredential(googleIdToken, null))
                    .addOnCompleteListener(this@MainActivity) { task ->
                        isBusy = false
                        if (task.isSuccessful) {
                            currentUser = auth.currentUser
                            if (roomSession == null) {
                                statusMessage = "Google 로그인에 성공했습니다. 새 방을 만들거나 초대 코드로 참가하세요."
                            } else {
                                statusMessage = "로그인에 성공했습니다. 저장된 대기실에 다시 연결합니다."
                                reconnectRoom()
                            }
                        } else {
                            val detail = task.exception?.localizedMessage
                            statusMessage = if (detail.isNullOrBlank()) {
                                "Firebase 로그인에 실패했습니다. Google 제공자와 SHA-1 설정을 확인하세요."
                            } else {
                                "Firebase 로그인 실패: $detail (Google 제공자와 SHA-1 설정도 확인하세요.)"
                            }
                        }
                    }
            } catch (error: GetCredentialException) {
                isBusy = false
                val detail = error.localizedMessage
                statusMessage = if (detail.isNullOrBlank()) {
                    "Google 계정 선택 화면을 열지 못했습니다 (${error.javaClass.simpleName}). Google Play 서비스와 휴대폰 계정 설정을 확인하세요."
                } else {
                    "Google 계정 선택 화면을 열지 못했습니다 (${error.javaClass.simpleName}): $detail"
                }
            } catch (error: Exception) {
                isBusy = false
                statusMessage = error.localizedMessage ?: "Google 로그인 중 오류가 발생했습니다."
            }
        }
    }

    private fun signOut() {
        closeRoomStream()
        roomSessionStore.clear()
        firebaseAuth?.signOut()
        currentUser = null
        roomSession = null
        roomSnapshot = null
        roomConnectionStatus = "연결 안 됨"
        statusMessage = "로그아웃했습니다."
        lifecycleScope.launch {
            try {
                credentialManager.clearCredentialState(ClearCredentialStateRequest())
            } catch (_: Exception) {
                // Firebase is signed out even if a credential provider cannot clear its cached state.
            }
        }
    }

    private fun openDeckEditor() {
        isDeckEditorOpen = true
    }

    private fun saveDeck(deck: PlayerDeck) {
        playerDeck = deck
        deckStore.save(deck)
        isDeckEditorOpen = false
        statusMessage = if (DeckRules.validate(deck, deckCardCatalog).isEmpty()) {
            "덱을 저장했습니다."
        } else {
            "덱을 저장했습니다. 대전 준비 전에 메인 덱을 40~60장으로 맞춰 주세요."
        }
    }

    private fun saveAiDuelDeck(deck: PlayerDeck) {
        val savedDeck = AiDuelDeck(name = "내 AI 덱", cards = deck)
        aiDuelDeck = savedDeck
        aiDuelStore.saveDeck(savedDeck)
        isAiDeckEditorOpen = false
        aiDuelStatusMessage = ""
    }

    private fun deckSummary(): String = "메인 ${playerDeck.main.size}장 · 키 카드 ${playerDeck.key.size}장"

    private fun createRoom() {
        performRoomRequest { idToken, displayName ->
            RoomApi.createRoom(BuildConfig.ROOM_SERVER_URL, idToken, displayName)
        }
    }

    private fun joinRoom(roomCode: String) {
        val parsedCode = RoomCode.parse(roomCode) ?: run {
            statusMessage = "네 자리 방 코드를 입력하세요."
            return
        }
        performRoomRequest { idToken, displayName ->
            RoomApi.joinRoom(BuildConfig.ROOM_SERVER_URL, parsedCode.value, idToken, displayName)
        }
    }

    private fun setReady(ready: Boolean) {
        val session = roomSession ?: return
        val deck = playerDeck
        if (ready) {
            val errors = DeckRules.validate(deck, deckCardCatalog)
            if (errors.isNotEmpty()) {
                statusMessage = errors.first()
                return
            }
        }
        val user = firebaseAuth?.currentUser
        if (user == null) {
            statusMessage = "대기실에 연결하려면 Google 계정으로 로그인하세요."
            return
        }
        if (roomActionBusy || isRoomConnecting) return
        roomActionBusy = true
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                val idToken = tokenResult.token
                if (idToken.isNullOrBlank()) {
                    roomActionBusy = false
                    statusMessage = "Firebase 인증 토큰을 가져오지 못했습니다."
                    return@addOnSuccessListener
                }
                lifecycleScope.launch {
                    try {
                        val snapshot = withContext(Dispatchers.IO) {
                            RoomApi.setReady(BuildConfig.ROOM_SERVER_URL, idToken, session, ready, deck)
                        }
                        publishRoomSnapshot(snapshot)
                        statusMessage = ""
                    } catch (error: Exception) {
                        statusMessage = error.localizedMessage ?: "준비 상태를 변경하지 못했습니다."
                    } finally {
                        roomActionBusy = false
                    }
                }
            }
            .addOnFailureListener { error ->
                roomActionBusy = false
                statusMessage = error.localizedMessage ?: "Firebase 인증 토큰을 가져오지 못했습니다."
            }
    }

    private fun submitGameAction(action: DuelActionRequest) {
        val session = roomSession ?: return
        val user = firebaseAuth?.currentUser
        if (user == null) {
            statusMessage = "대전에 참여하려면 Google 계정으로 로그인하세요."
            return
        }
        if (roomActionBusy || isRoomConnecting) return
        roomActionBusy = true
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                val idToken = tokenResult.token
                if (idToken.isNullOrBlank()) {
                    roomActionBusy = false
                    statusMessage = "Firebase 인증 토큰을 가져오지 못했습니다."
                    return@addOnSuccessListener
                }
                lifecycleScope.launch {
                    try {
                        val snapshot = withContext(Dispatchers.IO) {
                            RoomApi.submitGameAction(
                                BuildConfig.ROOM_SERVER_URL,
                                idToken,
                                session,
                                action,
                            )
                        }
                        publishRoomSnapshot(snapshot)
                        statusMessage = ""
                    } catch (error: Exception) {
                        statusMessage = error.localizedMessage ?: "게임 행동을 처리하지 못했습니다."
                    } finally {
                        roomActionBusy = false
                    }
                }
            }
            .addOnFailureListener { error ->
                roomActionBusy = false
                statusMessage = error.localizedMessage ?: "Firebase 인증 토큰을 가져오지 못했습니다."
            }
    }

    private fun reconnectRoom() {
        val session = roomSession ?: return
        val user = firebaseAuth?.currentUser
        if (user == null) {
            roomConnectionStatus = "Google 로그인 필요"
            statusMessage = "저장된 대기실에 다시 연결하려면 Google 계정으로 로그인하세요."
            return
        }
        if (isRoomConnecting) return
        val generation = roomFlowGeneration
        isRoomConnecting = true
        roomConnectionStatus = "방 연결 복구 중…"
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                if (generation != roomFlowGeneration || roomSession != session) return@addOnSuccessListener
                val idToken = tokenResult.token
                if (idToken.isNullOrBlank()) {
                    isRoomConnecting = false
                    roomConnectionStatus = "연결 복구 실패"
                    statusMessage = "Firebase 인증 토큰을 가져오지 못했습니다."
                    return@addOnSuccessListener
                }
                lifecycleScope.launch {
                    try {
                        val snapshot = withContext(Dispatchers.IO) {
                            RoomApi.reconnectRoom(BuildConfig.ROOM_SERVER_URL, idToken, session)
                        }
                        if (generation != roomFlowGeneration || roomSession != session) return@launch
                        publishRoomSnapshot(snapshot)
                        statusMessage = ""
                        openRoomStream(session, idToken)
                    } catch (error: RoomApiException) {
                        if (generation != roomFlowGeneration || roomSession != session) return@launch
                        roomConnectionStatus = "연결 복구 실패"
                        statusMessage = error.localizedMessage ?: "대기실 연결을 복구하지 못했습니다."
                        if (error.errorCode == "room_not_found" || error.errorCode == "invalid_seat_token") {
                            closeRoomStream()
                            roomSessionStore.clear()
                            roomSession = null
                            roomSnapshot = null
                        }
                    } catch (error: Exception) {
                        if (generation != roomFlowGeneration || roomSession != session) return@launch
                        roomConnectionStatus = "연결 복구 실패"
                        statusMessage = error.localizedMessage ?: "대기실 연결을 복구하지 못했습니다."
                    } finally {
                        if (generation == roomFlowGeneration) isRoomConnecting = false
                    }
                }
            }
            .addOnFailureListener { error ->
                if (generation == roomFlowGeneration && roomSession == session) {
                    isRoomConnecting = false
                    roomConnectionStatus = "연결 복구 실패"
                    statusMessage = error.localizedMessage ?: "Firebase 인증 토큰을 가져오지 못했습니다."
                }
            }
    }

    private fun leaveRoom() {
        val session = roomSession
        roomFlowGeneration += 1
        closeRoomStream()
        roomSessionStore.clear()
        roomSession = null
        roomSnapshot = null
        roomConnectionStatus = "연결 안 됨"
        isRoomConnecting = false
        roomActionBusy = false
        statusMessage = if (session == null) "연결 요청을 취소했습니다." else "방에서 나왔습니다."
        if (session == null) {
            isBusy = false
            return
        }

        val user = firebaseAuth?.currentUser ?: return
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                val idToken = tokenResult.token ?: return@addOnSuccessListener
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        RoomApi.leaveRoom(BuildConfig.ROOM_SERVER_URL, idToken, session)
                    } catch (_: Exception) {
                        // Local navigation has completed, so a failed cleanup must not trap the player in the room.
                    }
                }
            }
    }

    private fun openRoomStream(session: RoomSession, idToken: String) {
        closeRoomStream()
        val generation = roomStreamGeneration
        roomConnectionStatus = "실시간 방 연결 중…"
        roomStream = RoomApi.openRoomStream(
            serverUrl = BuildConfig.ROOM_SERVER_URL,
            idToken = idToken,
            session = session,
            onConnected = {
                runOnUiThread {
                    if (generation == roomStreamGeneration && roomSession == session) {
                        roomConnectionStatus = "실시간 연결됨"
                        statusMessage = ""
                    }
                }
            },
            onSnapshot = { snapshot ->
                runOnUiThread {
                    if (generation == roomStreamGeneration && roomSession == session) {
                        publishRoomSnapshot(snapshot)
                        roomConnectionStatus = "실시간 연결됨"
                    }
                }
            },
            onDisconnected = { reason ->
                runOnUiThread {
                    if (generation == roomStreamGeneration && roomSession == session) {
                        roomStream = null
                        roomConnectionStatus = "연결 끊김"
                        if (reason.isNotBlank()) statusMessage = reason
                    }
                }
            },
        )
    }

    private fun closeRoomStream() {
        roomStreamGeneration += 1
        roomStream?.close(1000, "Leaving room")
        roomStream = null
    }

    private fun publishRoomSnapshot(snapshot: RoomSnapshot) {
        if (snapshot.roomCode != roomSession?.roomCode) return
        val current = roomSnapshot
        if (current == null || snapshot.sequence >= current.sequence) roomSnapshot = snapshot
    }

    private fun startAiDuel(aiDeck: AiDuelDeck, aiName: String) {
        if (aiDuelBusy) return
        val deckErrors = DeckRules.validate(playerDeck, deckCardCatalog)
        if (deckErrors.isNotEmpty()) {
            aiDuelStatusMessage = deckErrors.first()
            return
        }

        val generation = ++aiDuelStartGeneration
        aiDuelBusy = true
        aiDuelStatusMessage = "AI 대전을 만들고 있습니다…"
        lifecycleScope.launch {
            try {
                val match = withContext(Dispatchers.IO) {
                    AiDuelApi.create(
                        serverUrl = BuildConfig.AI_DUEL_SERVER_URL,
                        humanDeck = playerDeck,
                        aiDeck = aiDeck,
                        aiName = aiName,
                    )
                }
                if (generation != aiDuelStartGeneration) return@launch
                val session = AiDuelSession(gameCode = match.code, aiName = match.aiName)
                aiDuelStore.save(session)
                aiDuelSession = session
                aiDuelMatch = match
                aiDuelConnectionStatus = "연결됨"
                aiDuelStatusMessage = ""
                isAiDuelSetupOpen = false
            } catch (error: Exception) {
                if (generation == aiDuelStartGeneration) {
                    aiDuelStatusMessage = error.localizedMessage ?: "AI 대전을 시작하지 못했습니다."
                }
            } finally {
                if (generation == aiDuelStartGeneration) aiDuelBusy = false
            }
        }
    }

    private fun refreshAiDuel() {
        val session = aiDuelSession ?: return
        if (aiDuelBusy || aiDuelRefreshing) return
        aiDuelRefreshing = true
        lifecycleScope.launch {
            try {
                val updated = withContext(Dispatchers.IO) {
                    AiDuelApi.getState(BuildConfig.AI_DUEL_SERVER_URL, session.gameCode)
                }
                if (aiDuelSession?.gameCode == session.gameCode) {
                    publishAiDuelMatch(updated)
                    aiDuelConnectionStatus = "연결됨"
                    aiDuelStatusMessage = ""
                }
            } catch (error: Exception) {
                if (aiDuelSession?.gameCode == session.gameCode) {
                    aiDuelConnectionStatus = "연결 끊김"
                    aiDuelStatusMessage = error.localizedMessage ?: "AI 대전 상태를 불러오지 못했습니다."
                }
            } finally {
                aiDuelRefreshing = false
            }
        }
    }

    private fun submitAiDuelAction(action: DuelActionRequest) {
        val session = aiDuelSession ?: return
        if (aiDuelBusy) return
        aiDuelBusy = true
        lifecycleScope.launch {
            try {
                val updated = withContext(Dispatchers.IO) {
                    AiDuelApi.submitHumanAction(
                        BuildConfig.AI_DUEL_SERVER_URL,
                        session.gameCode,
                        action,
                    )
                }
                publishAiDuelMatch(updated)
                aiDuelConnectionStatus = "연결됨"
                aiDuelStatusMessage = ""
            } catch (error: Exception) {
                aiDuelStatusMessage = error.localizedMessage ?: "행동을 처리하지 못했습니다."
            } finally {
                aiDuelBusy = false
            }
        }
    }

    private fun publishAiDuelMatch(updated: AiDuelMatch) {
        if (updated.code != aiDuelSession?.gameCode) return
        val current = aiDuelMatch
        if (current == null || updated.revision >= current.revision) aiDuelMatch = updated
    }

    private fun closeAiDuelSetup() {
        aiDuelStartGeneration += 1
        aiDuelBusy = false
        isAiDuelSetupOpen = false
        aiDuelStatusMessage = ""
    }

    private fun leaveAiDuel() {
        aiDuelStartGeneration += 1
        aiDuelStore.clear()
        aiDuelSession = null
        aiDuelMatch = null
        aiDuelConnectionStatus = "연결 안 됨"
        aiDuelStatusMessage = ""
        aiDuelBusy = false
        aiDuelRefreshing = false
    }

    private fun cancelRoomRequest() {
        roomFlowGeneration += 1
        isBusy = false
        statusMessage = "연결 요청을 취소했습니다."
    }

    private fun performRoomRequest(request: (idToken: String, displayName: String) -> RoomSessionResult) {
        val user = firebaseAuth?.currentUser
        if (user == null) {
            statusMessage = "먼저 Google 계정으로 로그인하세요."
            return
        }

        val generation = ++roomFlowGeneration
        isBusy = true
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                if (generation != roomFlowGeneration) return@addOnSuccessListener
                val idToken = tokenResult.token
                if (idToken.isNullOrBlank()) {
                    isBusy = false
                    statusMessage = "Firebase 인증 토큰을 가져오지 못했습니다. 다시 로그인하세요."
                    return@addOnSuccessListener
                }
                val displayName = user.displayName?.takeIf { it.isNotBlank() }
                    ?: user.email?.substringBefore('@')
                    ?: "Player"
                lifecycleScope.launch {
                    try {
                        val result = withContext(Dispatchers.IO) { request(idToken, displayName) }
                        if (generation != roomFlowGeneration) {
                            withContext(Dispatchers.IO) {
                                try {
                                    RoomApi.leaveRoom(BuildConfig.ROOM_SERVER_URL, idToken, result.session)
                                } catch (_: Exception) {
                                    // A canceled room request must not restore the lobby screen.
                                }
                            }
                            return@launch
                        }
                        roomSession = result.session
                        roomSnapshot = result.snapshot
                        roomSessionStore.save(result.session)
                        roomConnectionStatus = "실시간 방 연결 중…"
                        statusMessage = "방에 연결했습니다. 상대에게 방 코드 ${result.session.roomCode}를 알려주세요."
                        openRoomStream(result.session, idToken)
                    } catch (error: Exception) {
                        if (generation == roomFlowGeneration) {
                            statusMessage = error.localizedMessage ?: "방 서버에 연결하지 못했습니다."
                        }
                    } finally {
                        if (generation == roomFlowGeneration) isBusy = false
                    }
                }
            }
            .addOnFailureListener { error ->
                if (generation == roomFlowGeneration) {
                    isBusy = false
                    statusMessage = error.localizedMessage ?: "Firebase 인증 토큰을 가져오지 못했습니다."
                }
            }
    }

}

@Composable
private fun OnlineStartScreen(
    currentUser: FirebaseUser?,
    signInEnabled: Boolean,
    roomActionsEnabled: Boolean,
    isBusy: Boolean,
    firebaseSetupMessage: String,
    statusMessage: String,
    roomSession: RoomSession?,
    deckSummary: String,
    onEditDeck: () -> Unit,
    onAiDuel: () -> Unit,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onCreateRoom: () -> Unit,
    onJoinRoom: (String) -> Unit,
) {
    var roomCodeInput by remember { mutableStateOf("") }
    val roomCodeIsValid = RoomCode.parse(roomCodeInput) != null

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(horizontal = 36.dp, vertical = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "HAND BATTLE",
                color = Accent,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                text = "친구와 온라인 대전",
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "방을 만들고 네 자리 초대 코드로 상대를 불러오세요.",
                color = Muted,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(24.dp))
            Text(
                text = "서버가 방과 준비 상태를 관리합니다. 상대와 대기실에서 연결을 확인할 수 있습니다.",
                color = Muted,
                fontSize = 14.sp,
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .background(Panel, RoundedCornerShape(20.dp))
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("온라인 대전", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            if (currentUser == null) {
                Text("Google 계정으로 로그인", color = Muted, fontSize = 14.sp)
                Button(
                    onClick = onSignIn,
                    enabled = signInEnabled,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
                ) {
                    Text(if (isBusy) "연결 중…" else "Google로 로그인", color = Color.White, modifier = Modifier.padding(vertical = 5.dp))
                }
            } else {
                Text(
                    text = currentUser.displayName ?: currentUser.email ?: "로그인됨",
                    color = Color.White,
                    fontSize = 14.sp,
                )
                Button(
                    onClick = onSignOut,
                    enabled = !isBusy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
                ) {
                    Text("로그아웃", color = Color(0xFFCFD4DE), modifier = Modifier.padding(vertical = 5.dp))
                }
            }
            Text(deckSummary, color = Accent, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Button(
                onClick = onEditDeck,
                enabled = !isBusy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text("덱 편집", color = Color(0xFFCFD4DE), modifier = Modifier.padding(vertical = 5.dp))
            }
            Button(
                onClick = onAiDuel,
                enabled = !isBusy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Color(0xFF343A46),
                ),
            ) {
                Text("AI 대전", color = Color(0xFF101218), modifier = Modifier.padding(vertical = 5.dp))
            }
            OutlinedTextField(
                value = roomCodeInput,
                onValueChange = { entered ->
                    roomCodeInput = entered.filter { it in '0'..'9' }.take(RoomCode.LENGTH)
                },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("네 자리 방 코드") },
                placeholder = { Text("예: 0427") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Muted,
                    focusedLabelColor = Accent,
                    unfocusedLabelColor = Muted,
                    cursorColor = Accent,
                ),
            )
            Button(
                onClick = { onJoinRoom(roomCodeInput) },
                enabled = roomCodeIsValid && roomActionsEnabled,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text("방 참가", color = Color(0xFFCFD4DE), modifier = Modifier.padding(vertical = 5.dp))
            }
            Button(
                onClick = onCreateRoom,
                enabled = roomActionsEnabled,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text("새 방 만들기", color = Color(0xFFCFD4DE), modifier = Modifier.padding(vertical = 5.dp))
            }
            roomSession?.let { session ->
                Text(
                    text = "방 코드  " + session.roomCode + "   ·   내 자리 " + (session.seat + 1),
                    color = Accent,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                text = if (statusMessage.isNotBlank()) statusMessage else firebaseSetupMessage,
                color = Muted,
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
        }
    }
}
package com.simsy.handbattle

import android.os.Bundle
import androidx.activity.ComponentActivity
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.simsy.handbattle.online.RoomApi
import com.simsy.handbattle.online.RoomCode
import com.simsy.handbattle.online.RoomSession
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
    private var roomSession by mutableStateOf<RoomSession?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureFirebase()
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Background) {
                    OnlineStartScreen(
                        currentUser = currentUser,
                        signInEnabled = firebaseAuth != null && googleClientId.isNotBlank() && !isBusy,
                        roomActionsEnabled = currentUser != null && !isBusy,
                        isBusy = isBusy,
                        firebaseSetupMessage = firebaseSetupMessage,
                        statusMessage = statusMessage,
                        roomSession = roomSession,
                        onSignIn = ::signInWithGoogle,
                        onSignOut = ::signOut,
                        onCreateRoom = ::createRoom,
                        onJoinRoom = ::joinRoom,
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        authStateListener?.let { listener -> firebaseAuth?.addAuthStateListener(listener) }
    }

    override fun onStop() {
        authStateListener?.let { listener -> firebaseAuth?.removeAuthStateListener(listener) }
        super.onStop()
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
        authStateListener = FirebaseAuth.AuthStateListener { auth -> currentUser = auth.currentUser }

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
                val googleOption = GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(false)
                    .setServerClientId(googleClientId)
                    .setAutoSelectEnabled(false)
                    .build()
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
                            roomSession = null
                            statusMessage = "Google 로그인에 성공했습니다. 새 방을 만들거나 초대 코드로 참가하세요."
                        } else {
                            statusMessage = "Firebase 로그인에 실패했습니다. Google 제공자와 SHA-1 설정을 확인하세요."
                        }
                    }
            } catch (error: GetCredentialException) {
                isBusy = false
                statusMessage = "Google 로그인이 완료되지 않았습니다. 계정을 선택했는지 확인하세요."
            } catch (error: Exception) {
                isBusy = false
                statusMessage = error.localizedMessage ?: "Google 로그인 중 오류가 발생했습니다."
            }
        }
    }

    private fun signOut() {
        firebaseAuth?.signOut()
        currentUser = null
        roomSession = null
        statusMessage = "로그아웃했습니다."
        lifecycleScope.launch {
            try {
                credentialManager.clearCredentialState(ClearCredentialStateRequest())
            } catch (_: Exception) {
                // Firebase is signed out even if a credential provider cannot clear its cached state.
            }
        }
    }

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

    private fun performRoomRequest(request: (idToken: String, displayName: String) -> RoomSession) {
        val user = firebaseAuth?.currentUser
        if (user == null) {
            statusMessage = "먼저 Google 계정으로 로그인하세요."
            return
        }

        isBusy = true
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
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
                        val session = withContext(Dispatchers.IO) { request(idToken, displayName) }
                        roomSession = session
                        statusMessage = if (session.phase == "waiting") {
                            "방 연결 완료. 이 코드를 상대에게 알려주세요."
                        } else {
                            "방에 연결했습니다."
                        }
                    } catch (error: Exception) {
                        statusMessage = error.localizedMessage ?: "방 서버에 연결하지 못했습니다."
                    } finally {
                        isBusy = false
                    }
                }
            }
            .addOnFailureListener { error ->
                isBusy = false
                statusMessage = error.localizedMessage ?: "Firebase 인증 토큰을 가져오지 못했습니다."
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
                text = "서버가 방 상태를 관리합니다. 현재는 로그인, 방 생성, 참가까지 연결되어 있습니다.",
                color = Muted,
                fontSize = 14.sp,
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .background(Panel, RoundedCornerShape(20.dp))
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

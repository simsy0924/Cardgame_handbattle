import { APP_CONFIG } from './config.js';
import { clearSession, loadSession, saveSession } from './core/session.js';
import { launchGame } from './game-bridge.js';
import { loginWithGoogle, logout, observeAuth } from './services/firebase-client.js';
import { ensureProfile, getProfile, updateNickname } from './services/profile-service.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  normaliseRoomCode,
  reconnectRoom,
  startRoom,
  subscribeRoom,
} from './services/room-service.js';

const dom = Object.freeze({
  lobbyView: document.querySelector('#lobbyView'),
  waitingView: document.querySelector('#waitingView'),
  gameView: document.querySelector('#gameView'),
  connectionBadge: document.querySelector('#connectionBadge'),
  loggedOutArea: document.querySelector('#loggedOutArea'),
  profileArea: document.querySelector('#profileArea'),
  profileAvatar: document.querySelector('#profileAvatar'),
  profileAvatarFallback: document.querySelector('#profileAvatarFallback'),
  profileName: document.querySelector('#profileName'),
  profileStats: document.querySelector('#profileStats'),
  profileCurrency: document.querySelector('#profileCurrency'),
  nicknameInput: document.querySelector('#nicknameInput'),
  nicknameForm: document.querySelector('#nicknameForm'),
  playerNameInput: document.querySelector('#playerNameInput'),
  googleLoginButton: document.querySelector('#googleLoginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  createRoomButton: document.querySelector('#createRoomButton'),
  createRoomStatus: document.querySelector('#createRoomStatus'),
  joinRoomForm: document.querySelector('#joinRoomForm'),
  joinRoomButton: document.querySelector('#joinRoomButton'),
  roomCodeInput: document.querySelector('#roomCodeInput'),
  joinRoomStatus: document.querySelector('#joinRoomStatus'),
  resumePanel: document.querySelector('#resumePanel'),
  resumeDescription: document.querySelector('#resumeDescription'),
  resumeButton: document.querySelector('#resumeButton'),
  forgetSessionButton: document.querySelector('#forgetSessionButton'),
  waitingRoomCode: document.querySelector('#waitingRoomCode'),
  copyRoomCodeButton: document.querySelector('#copyRoomCodeButton'),
  hostName: document.querySelector('#hostName'),
  guestName: document.querySelector('#guestName'),
  hostConnection: document.querySelector('#hostConnection'),
  guestConnection: document.querySelector('#guestConnection'),
  waitingStatus: document.querySelector('#waitingStatus'),
  startMatchButton: document.querySelector('#startMatchButton'),
  leaveRoomButton: document.querySelector('#leaveRoomButton'),
  aiBattleButton: document.querySelector('#aiBattleButton'),
  tutorialButton: document.querySelector('#tutorialButton'),
  aboutButton: document.querySelector('#aboutButton'),
  modalBackdrop: document.querySelector('#modalBackdrop'),
  tutorialModal: document.querySelector('#tutorialModal'),
  aboutModal: document.querySelector('#aboutModal'),
  returnLobbyButton: document.querySelector('#returnLobbyButton'),
  gameMount: document.querySelector('#gameMount'),
  toastRegion: document.querySelector('#toastRegion'),
});

const state = {
  user: null,
  profile: null,
  room: null,
  roomCode: null,
  role: null,
  seatToken: null,
  roomUnsubscribe: null,
  enteringRoom: false,
};

function showView(view) {
  [dom.lobbyView, dom.waitingView, dom.gameView].forEach((item) => item.classList.toggle('hidden', item !== view));
}

function setBusy(button, busy, busyLabel = '처리 중...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

function setStatus(element, message, visible = true) {
  element.textContent = message;
  element.classList.toggle('hidden', !visible);
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  item.textContent = message;
  dom.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3200);
}

function cleanPlayerName() {
  const candidate = dom.playerNameInput.value.trim() || state.profile?.nickname || state.user?.displayName || '';
  return candidate.slice(0, 12);
}

function requireUser() {
  if (state.user) return true;
  toast('방 기능은 Google 로그인 후 사용할 수 있습니다.', 'error');
  return false;
}

function renderAuth() {
  const loggedIn = Boolean(state.user);
  dom.loggedOutArea.classList.toggle('hidden', loggedIn);
  dom.profileArea.classList.toggle('hidden', !loggedIn);
  dom.connectionBadge.textContent = loggedIn ? '로그인됨' : '로그인 필요';
  dom.connectionBadge.className = `badge ${loggedIn ? 'badge-online' : 'badge-muted'}`;

  if (!loggedIn) return;
  const profile = state.profile || {};
  const nickname = profile.nickname || state.user.displayName || '플레이어';
  dom.profileName.textContent = nickname;
  dom.profileStats.textContent = `${profile.totalWins || 0}승 ${profile.totalLosses || 0}패 · 레이팅 ${profile.rating || 1000}`;
  dom.profileCurrency.textContent = `${profile.currency || 0} G`;
  dom.nicknameInput.placeholder = nickname;
  if (!dom.playerNameInput.value.trim()) dom.playerNameInput.value = nickname;

  if (state.user.photoURL) {
    dom.profileAvatar.src = state.user.photoURL;
    dom.profileAvatar.classList.remove('hidden');
    dom.profileAvatarFallback.classList.add('hidden');
  } else {
    dom.profileAvatar.classList.add('hidden');
    dom.profileAvatarFallback.classList.remove('hidden');
    dom.profileAvatarFallback.textContent = nickname.slice(0, 1).toUpperCase();
  }
}

function renderResumePanel() {
  const session = loadSession();
  const canResume = Boolean(state.user && session?.uid === state.user.uid && session.roomCode);
  dom.resumePanel.classList.toggle('hidden', !canResume);
  if (canResume) {
    dom.resumeDescription.textContent = `${session.roomCode} 방에 ${session.role === 'host' ? '호스트' : '게스트'}로 다시 들어갈 수 있습니다.`;
  }
}

function renderSeat(nameElement, badgeElement, seat) {
  nameElement.textContent = seat?.name || '대기 중';
  if (!seat) {
    badgeElement.textContent = '비어 있음';
    badgeElement.className = 'badge badge-muted';
    return;
  }
  badgeElement.textContent = seat.connected === false ? '연결 끊김' : '접속 중';
  badgeElement.className = `badge ${seat.connected === false ? 'badge-warning' : 'badge-online'}`;
}

function renderWaitingRoom() {
  const room = state.room;
  dom.waitingRoomCode.textContent = state.roomCode || '----';
  renderSeat(dom.hostName, dom.hostConnection, room?.host);
  renderSeat(dom.guestName, dom.guestConnection, room?.guest);

  const isHost = state.role === 'host';
  const canStart = Boolean(isHost && room?.guest && room.status === 'waiting');
  dom.startMatchButton.classList.toggle('hidden', !isHost);
  dom.startMatchButton.disabled = !canStart;

  if (!room) dom.waitingStatus.textContent = '방 정보를 불러오는 중입니다.';
  else if (room.status === 'playing') dom.waitingStatus.textContent = '게임을 시작합니다.';
  else if (!room.guest) dom.waitingStatus.textContent = '상대에게 방 코드를 알려주세요.';
  else if (isHost) dom.waitingStatus.textContent = '두 플레이어가 준비되었습니다. 게임을 시작할 수 있습니다.';
  else dom.waitingStatus.textContent = '호스트가 게임을 시작하기를 기다리는 중입니다.';
}

function stopRoomSubscription() {
  if (typeof state.roomUnsubscribe === 'function') state.roomUnsubscribe();
  state.roomUnsubscribe = null;
}

function rememberCurrentRoom() {
  saveSession({
    uid: state.user.uid,
    roomCode: state.roomCode,
    role: state.role,
    seatToken: state.seatToken,
    playerName: cleanPlayerName(),
  });
  renderResumePanel();
}

async function enterWaitingRoom(result) {
  stopRoomSubscription();
  state.roomCode = result.code;
  state.role = result.role;
  state.seatToken = result.seatToken;
  state.room = result.room;
  rememberCurrentRoom();
  renderWaitingRoom();
  showView(dom.waitingView);

  state.roomUnsubscribe = subscribeRoom(result.code, async (room) => {
    if (!room) {
      toast('방이 종료되었습니다.', 'error');
      await resetToLobby({ forgetSession: true });
      return;
    }
    state.room = room;
    renderWaitingRoom();
    if (room.status === 'playing') await openGame({ mode: 'online', room });
  });
}

async function openGame({ mode, room = null }) {
  stopRoomSubscription();
  showView(dom.gameView);
  const context = mode === 'online'
    ? {
        mode,
        roomCode: state.roomCode,
        role: state.role,
        seatToken: state.seatToken,
        players: {
          host: room?.host ? { uid: room.host.uid, name: room.host.name } : null,
          guest: room?.guest ? { uid: room.guest.uid, name: room.guest.name } : null,
        },
      }
    : {
        mode: 'ai',
        player: { uid: state.user?.uid || null, name: cleanPlayerName() || '플레이어' },
      };

  await launchGame(context, dom.gameMount);
}

async function resetToLobby({ forgetSession = false } = {}) {
  stopRoomSubscription();
  state.room = null;
  state.roomCode = null;
  state.role = null;
  state.seatToken = null;
  dom.gameMount.replaceChildren();
  if (forgetSession) clearSession();
  renderResumePanel();
  showView(dom.lobbyView);
}

async function handleCreateRoom() {
  if (!requireUser() || state.enteringRoom) return;
  const name = cleanPlayerName();
  if (!name) {
    toast('표시할 이름을 입력하세요.', 'error');
    dom.playerNameInput.focus();
    return;
  }

  state.enteringRoom = true;
  setBusy(dom.createRoomButton, true, '방 만드는 중...');
  setStatus(dom.createRoomStatus, 'Firebase에서 빈 방 코드를 찾는 중입니다.');
  try {
    const result = await createRoom({ uid: state.user.uid, name });
    await enterWaitingRoom(result);
  } catch (error) {
    setStatus(dom.createRoomStatus, error.message || '방 생성에 실패했습니다.');
    toast(error.message || '방 생성에 실패했습니다.', 'error');
  } finally {
    state.enteringRoom = false;
    setBusy(dom.createRoomButton, false);
  }
}

async function handleJoinRoom(event) {
  event.preventDefault();
  if (!requireUser() || state.enteringRoom) return;
  const code = normaliseRoomCode(dom.roomCodeInput.value);
  const name = cleanPlayerName();
  if (!name) {
    toast('표시할 이름을 입력하세요.', 'error');
    dom.playerNameInput.focus();
    return;
  }

  state.enteringRoom = true;
  setBusy(dom.joinRoomButton, true, '참가 중...');
  setStatus(dom.joinRoomStatus, `${code || '----'} 방을 확인하는 중입니다.`);
  try {
    const result = await joinRoom({ code, uid: state.user.uid, name });
    await enterWaitingRoom(result);
  } catch (error) {
    setStatus(dom.joinRoomStatus, error.message || '방 참가에 실패했습니다.');
    toast(error.message || '방 참가에 실패했습니다.', 'error');
  } finally {
    state.enteringRoom = false;
    setBusy(dom.joinRoomButton, false);
  }
}

async function handleResume() {
  if (!requireUser()) return;
  const session = loadSession();
  if (!session) return;
  setBusy(dom.resumeButton, true, '복구 중...');
  try {
    const result = await reconnectRoom(session, state.user.uid);
    dom.playerNameInput.value = session.playerName || dom.playerNameInput.value;
    await enterWaitingRoom(result);
  } catch (error) {
    clearSession();
    renderResumePanel();
    toast(error.message || '이전 방을 복구하지 못했습니다.', 'error');
  } finally {
    setBusy(dom.resumeButton, false);
  }
}

async function handleStartMatch() {
  if (!state.user || !state.roomCode) return;
  setBusy(dom.startMatchButton, true, '시작 중...');
  try {
    await startRoom(state.roomCode, state.user.uid);
  } catch (error) {
    toast(error.message || '게임을 시작하지 못했습니다.', 'error');
    setBusy(dom.startMatchButton, false);
  }
}

async function handleLeaveRoom() {
  if (state.user && state.roomCode && state.role && state.seatToken) {
    try {
      await leaveRoom(state.roomCode, state.role, state.user.uid, state.seatToken);
    } catch (error) {
      console.warn('방 나가기 처리 실패:', error);
    }
  }
  await resetToLobby({ forgetSession: true });
}

function openModal(modal) {
  dom.modalBackdrop.classList.remove('hidden');
  dom.modalBackdrop.setAttribute('aria-hidden', 'false');
  [dom.tutorialModal, dom.aboutModal].forEach((item) => item.classList.toggle('hidden', item !== modal));
  modal.querySelector('button')?.focus();
}

function closeModal() {
  dom.modalBackdrop.classList.add('hidden');
  dom.modalBackdrop.setAttribute('aria-hidden', 'true');
  dom.tutorialModal.classList.add('hidden');
  dom.aboutModal.classList.add('hidden');
}

function bindEvents() {
  dom.googleLoginButton.addEventListener('click', async () => {
    setBusy(dom.googleLoginButton, true, '로그인 중...');
    try {
      await loginWithGoogle();
    } catch (error) {
      if (error?.code !== 'auth/popup-closed-by-user') toast(`로그인 실패: ${error.message}`, 'error');
    } finally {
      setBusy(dom.googleLoginButton, false);
    }
  });

  dom.logoutButton.addEventListener('click', async () => {
    await handleLeaveRoom();
    await logout();
  });

  dom.nicknameForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.user) return;
    const submitButton = dom.nicknameForm.querySelector('button');
    setBusy(submitButton, true, '저장 중...');
    try {
      const nickname = await updateNickname(state.user.uid, dom.nicknameInput.value);
      state.profile = await getProfile(state.user.uid);
      dom.nicknameInput.value = '';
      dom.playerNameInput.value = nickname;
      renderAuth();
      toast('닉네임을 저장했습니다.');
    } catch (error) {
      toast(error.message || '닉네임 저장에 실패했습니다.', 'error');
    } finally {
      setBusy(submitButton, false);
    }
  });

  dom.createRoomButton.addEventListener('click', handleCreateRoom);
  dom.joinRoomForm.addEventListener('submit', handleJoinRoom);
  dom.roomCodeInput.addEventListener('input', () => {
    dom.roomCodeInput.value = normaliseRoomCode(dom.roomCodeInput.value);
  });
  dom.resumeButton.addEventListener('click', handleResume);
  dom.forgetSessionButton.addEventListener('click', () => {
    clearSession();
    renderResumePanel();
  });
  dom.copyRoomCodeButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.roomCode || '');
      toast('방 코드를 복사했습니다.');
    } catch {
      toast(`방 코드: ${state.roomCode}`);
    }
  });
  dom.startMatchButton.addEventListener('click', handleStartMatch);
  dom.leaveRoomButton.addEventListener('click', handleLeaveRoom);
  dom.aiBattleButton.addEventListener('click', () => openGame({ mode: 'ai' }));
  dom.returnLobbyButton.addEventListener('click', () => resetToLobby({ forgetSession: false }));
  dom.tutorialButton.addEventListener('click', () => openModal(dom.tutorialModal));
  dom.aboutButton.addEventListener('click', () => openModal(dom.aboutModal));
  dom.modalBackdrop.addEventListener('click', (event) => {
    if (event.target === dom.modalBackdrop) closeModal();
  });
  document.querySelectorAll('.modal-close').forEach((button) => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.modalBackdrop.classList.contains('hidden')) closeModal();
  });
}

function start() {
  bindEvents();
  if (APP_CONFIG.demoMode) toast('demo=true가 감지됐지만 방 기능은 Firebase를 사용합니다.');

  observeAuth(async (user) => {
    state.user = user;
    state.profile = null;
    if (user) {
      try {
        state.profile = await ensureProfile(user);
      } catch (error) {
        console.error(error);
        toast('프로필을 불러오지 못했습니다.', 'error');
      }
    } else {
      clearSession();
      await resetToLobby({ forgetSession: true });
    }
    renderAuth();
    renderResumePanel();
  });
}

start();

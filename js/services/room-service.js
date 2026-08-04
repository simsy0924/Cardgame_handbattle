import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
import { APP_CONFIG } from '../config.js';
import { realtime } from './firebase-client.js';
import { makeSeatToken } from '../core/session.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let activeDisconnect = null;

function roomPath(code) {
  return `${APP_CONFIG.roomRoot}/${normaliseRoomCode(code)}`;
}

function roomRef(code) {
  return ref(realtime, roomPath(code));
}

function generateRoomCode() {
  return Array.from({ length: APP_CONFIG.roomCodeLength }, () => {
    return CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }).join('');
}

function makeSeat({ uid, name, seatToken }) {
  return {
    uid,
    name,
    token: seatToken,
    connected: true,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

export function normaliseRoomCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, APP_CONFIG.roomCodeLength);
}

export async function createRoom({ uid, name }) {
  if (!uid) throw new Error('로그인이 필요합니다.');
  const seatToken = makeSeatToken();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateRoomCode();
    const target = roomRef(code);
    const room = {
      schemaVersion: APP_CONFIG.schemaVersion,
      code,
      status: 'waiting',
      host: makeSeat({ uid, name, seatToken }),
      guest: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
    };

    const result = await runTransaction(target, (current) => current === null ? room : undefined, {
      applyLocally: false,
    });

    if (result.committed) {
      await attachPresence(code, 'host', seatToken);
      return { code, role: 'host', seatToken, room };
    }
  }

  throw new Error('빈 방 코드를 만들지 못했습니다. 다시 시도하세요.');
}

export async function joinRoom({ code, uid, name, seatToken = makeSeatToken() }) {
  if (!uid) throw new Error('로그인이 필요합니다.');
  const normalisedCode = normaliseRoomCode(code);
  if (normalisedCode.length !== APP_CONFIG.roomCodeLength) throw new Error('4자리 방 코드를 입력하세요.');

  const target = roomRef(normalisedCode);

  // Realtime Database 트랜잭션은 해당 경로가 로컬 캐시에 없으면
  // 서버 값을 받기 전에 update 함수에 null을 먼저 전달할 수 있다.
  // 참가 트랜잭션 전에 한 번 읽어 두어 실제 방을 null로 오인하지 않게 한다.
  let initialSnapshot;
  try {
    initialSnapshot = await get(target);
  } catch (error) {
    if (String(error?.code || '').toUpperCase().includes('PERMISSION_DENIED')) {
      throw new Error('방을 조회할 권한이 없습니다. 로그인 상태와 Firebase 규칙을 확인하세요.');
    }
    throw error;
  }
  if (!initialSnapshot.exists()) throw new Error('존재하지 않는 방입니다.');

  let rejection = '방에 참가할 수 없습니다.';

  const result = await runTransaction(target, (room) => {
    if (!room) {
      rejection = '방이 사라졌습니다.';
      return;
    }
    if (room.status === 'closed') {
      rejection = '종료된 방입니다.';
      return;
    }
    if (room.host?.uid === uid && room.host?.token === seatToken) {
      room.host.connected = true;
      room.host.lastSeenAt = Date.now();
      room.updatedAt = Date.now();
      return room;
    }
    if (room.guest?.uid === uid && room.guest?.token === seatToken) {
      room.guest.connected = true;
      room.guest.lastSeenAt = Date.now();
      room.updatedAt = Date.now();
      return room;
    }
    if (room.status !== 'waiting') {
      rejection = '이미 게임이 시작된 방입니다.';
      return;
    }
    if (room.guest) {
      rejection = '이미 두 명이 참가한 방입니다.';
      return;
    }

    room.guest = makeSeat({ uid, name, seatToken });
    room.updatedAt = Date.now();
    return room;
  }, { applyLocally: false });

  if (!result.committed) throw new Error(rejection);
  const room = result.snapshot.val();
  const role = room.host?.uid === uid && room.host?.token === seatToken ? 'host' : 'guest';
  await attachPresence(normalisedCode, role, seatToken);
  return { code: normalisedCode, role, seatToken, room };
}

export async function reconnectRoom(session, uid) {
  if (!session || !uid || session.uid !== uid) throw new Error('복구할 수 있는 세션이 아닙니다.');
  return joinRoom({
    code: session.roomCode,
    uid,
    name: session.playerName,
    seatToken: session.seatToken,
  });
}

export function subscribeRoom(code, callback) {
  return onValue(roomRef(code), (snapshot) => callback(snapshot.val()));
}

export async function startRoom(code, uid) {
  let rejection = '게임을 시작할 수 없습니다.';
  const result = await runTransaction(roomRef(code), (room) => {
    if (!room) {
      rejection = '방이 사라졌습니다.';
      return;
    }
    if (room.host?.uid !== uid) {
      rejection = '호스트만 게임을 시작할 수 있습니다.';
      return;
    }
    if (!room.guest) {
      rejection = '상대가 참가해야 합니다.';
      return;
    }
    if (room.status !== 'waiting') {
      rejection = '이미 게임이 시작되었습니다.';
      return;
    }

    room.status = 'playing';
    room.startedAt = Date.now();
    room.updatedAt = Date.now();
    return room;
  }, { applyLocally: false });

  if (!result.committed) throw new Error(rejection);
  return result.snapshot.val();
}

export async function leaveRoom(code, role, uid, seatToken) {
  if (activeDisconnect) {
    try { await activeDisconnect.cancel(); } catch (error) { console.warn('접속 종료 예약 해제 실패:', error); }
    activeDisconnect = null;
  }
  const target = roomRef(code);
  const snapshot = await get(target);
  const room = snapshot.val();
  if (!room) return;

  const seat = room?.[role];
  if (!seat || seat.uid !== uid || seat.token !== seatToken) return;

  if (role === 'host' && room.status === 'waiting') {
    await remove(target);
    return;
  }

  if (role === 'guest' && room.status === 'waiting') {
    await update(target, { guest: null, updatedAt: Date.now() });
    return;
  }

  await update(ref(realtime, `${roomPath(code)}/${role}`), {
    connected: false,
    lastSeenAt: Date.now(),
  });
}

async function attachPresence(code, role, seatToken) {
  if (activeDisconnect) {
    try { await activeDisconnect.cancel(); } catch (error) { console.warn('이전 접속 종료 예약 해제 실패:', error); }
    activeDisconnect = null;
  }
  const seat = ref(realtime, `${roomPath(code)}/${role}`);
  const snapshot = await get(seat);
  if (snapshot.val()?.token !== seatToken) return;

  const disconnect = onDisconnect(seat);
  await disconnect.update({ connected: false, lastSeenAt: Date.now() });
  activeDisconnect = disconnect;
  await set(ref(realtime, `${roomPath(code)}/${role}/connected`), true);
  await set(ref(realtime, `${roomPath(code)}/${role}/lastSeenAt`), Date.now());
}

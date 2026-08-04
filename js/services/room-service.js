import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  update,
} from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
import { APP_CONFIG } from '../config.js';
import { realtime } from './firebase-client.js';
import { makeSeatToken } from '../core/session.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let activeDisconnect = null;
let presenceUnsubscribe = null;
let presenceGeneration = 0;

function roomPath(code) {
  return `${APP_CONFIG.roomRoot}/${normaliseRoomCode(code)}`;
}

function roomRef(code) {
  return ref(realtime, roomPath(code));
}

function seatRef(code, role) {
  return ref(realtime, `${roomPath(code)}/${role}`);
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

function isSameSeat(seat, uid, seatToken) {
  return Boolean(seat && seat.uid === uid && seat.token === seatToken);
}

async function readRoom(code) {
  try {
    return await get(roomRef(code));
  } catch (error) {
    if (String(error?.code || '').toUpperCase().includes('PERMISSION_DENIED')) {
      throw new Error('방을 조회할 권한이 없습니다. 로그인 상태와 Firebase 규칙을 확인하세요.');
    }
    throw error;
  }
}

export function normaliseRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, APP_CONFIG.roomCodeLength);
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

    const result = await runTransaction(
      target,
      (current) => (current === null ? room : undefined),
      { applyLocally: false },
    );

    if (result.committed) {
      await attachPresence(code, 'host', seatToken);
      return { code, role: 'host', seatToken, room: result.snapshot.val() || room };
    }
  }

  throw new Error('빈 방 코드를 만들지 못했습니다. 다시 시도하세요.');
}

export async function joinRoom({ code, uid, name, seatToken = makeSeatToken() }) {
  if (!uid) throw new Error('로그인이 필요합니다.');

  const normalisedCode = normaliseRoomCode(code);
  if (normalisedCode.length !== APP_CONFIG.roomCodeLength) {
    throw new Error('4자리 방 코드를 입력하세요.');
  }

  const initialSnapshot = await readRoom(normalisedCode);
  if (!initialSnapshot.exists()) throw new Error('존재하지 않는 방입니다.');

  const initialRoom = initialSnapshot.val();
  if (initialRoom.status === 'closed') throw new Error('종료된 방입니다.');

  if (isSameSeat(initialRoom.host, uid, seatToken)) {
    await update(seatRef(normalisedCode, 'host'), {
      connected: true,
      lastSeenAt: serverTimestamp(),
    });
    await attachPresence(normalisedCode, 'host', seatToken);
    const latest = await readRoom(normalisedCode);
    return { code: normalisedCode, role: 'host', seatToken, room: latest.val() };
  }

  if (isSameSeat(initialRoom.guest, uid, seatToken)) {
    await update(seatRef(normalisedCode, 'guest'), {
      connected: true,
      lastSeenAt: serverTimestamp(),
    });
    await attachPresence(normalisedCode, 'guest', seatToken);
    const latest = await readRoom(normalisedCode);
    return { code: normalisedCode, role: 'guest', seatToken, room: latest.val() };
  }

  if (initialRoom.status !== 'waiting') {
    throw new Error('이미 게임이 시작된 방입니다.');
  }

  const candidate = makeSeat({ uid, name, seatToken });
  let rejection = '이미 두 명이 참가한 방입니다.';

  const result = await runTransaction(
    seatRef(normalisedCode, 'guest'),
    (currentGuest) => {
      if (currentGuest === null) return candidate;

      if (isSameSeat(currentGuest, uid, seatToken)) {
        return {
          ...currentGuest,
          name,
          connected: true,
          lastSeenAt: Date.now(),
        };
      }

      rejection = '이미 두 명이 참가한 방입니다.';
      return undefined;
    },
    { applyLocally: false },
  );

  if (!result.committed) throw new Error(rejection);

  await update(roomRef(normalisedCode), { updatedAt: serverTimestamp() });
  await attachPresence(normalisedCode, 'guest', seatToken);

  const latestSnapshot = await readRoom(normalisedCode);
  if (!latestSnapshot.exists()) throw new Error('방이 사라졌습니다.');

  return {
    code: normalisedCode,
    role: 'guest',
    seatToken,
    room: latestSnapshot.val(),
  };
}

export async function reconnectRoom(session, uid) {
  if (!session || !uid || session.uid !== uid) {
    throw new Error('복구할 수 있는 세션이 아닙니다.');
  }

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
  const normalisedCode = normaliseRoomCode(code);
  const snapshot = await readRoom(normalisedCode);
  if (!snapshot.exists()) throw new Error('방이 사라졌습니다.');

  const room = snapshot.val();
  if (room.host?.uid !== uid) throw new Error('호스트만 게임을 시작할 수 있습니다.');
  if (!room.guest) throw new Error('상대가 참가해야 합니다.');
  if (room.status !== 'waiting') throw new Error('이미 게임이 시작되었습니다.');

  await update(roomRef(normalisedCode), {
    status: 'playing',
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const latest = await readRoom(normalisedCode);
  return latest.val();
}

export async function leaveRoom(code, role, uid, seatToken) {
  await detachPresence();

  const normalisedCode = normaliseRoomCode(code);
  const target = roomRef(normalisedCode);
  const snapshot = await get(target);
  const room = snapshot.val();
  if (!room) return;

  const seat = room?.[role];
  if (!isSameSeat(seat, uid, seatToken)) return;

  if (role === 'host' && room.status === 'waiting') {
    await remove(target);
    return;
  }

  if (role === 'guest' && room.status === 'waiting') {
    await update(target, { guest: null, updatedAt: serverTimestamp() });
    return;
  }

  await update(seatRef(normalisedCode, role), {
    connected: false,
    lastSeenAt: serverTimestamp(),
  });
}

async function detachPresence() {
  presenceGeneration += 1;

  if (typeof presenceUnsubscribe === 'function') {
    presenceUnsubscribe();
    presenceUnsubscribe = null;
  }

  if (activeDisconnect) {
    try {
      await activeDisconnect.cancel();
    } catch (error) {
      console.warn('접속 종료 예약 해제 실패:', error);
    }
    activeDisconnect = null;
  }
}

async function attachPresence(code, role, seatToken) {
  await detachPresence();
  const generation = presenceGeneration;
  const seat = seatRef(code, role);
  const connectedRef = ref(realtime, '.info/connected');

  const snapshot = await get(seat);
  if (snapshot.val()?.token !== seatToken) return;

  presenceUnsubscribe = onValue(
    connectedRef,
    async (connectionSnapshot) => {
      if (connectionSnapshot.val() !== true || generation !== presenceGeneration) return;

      try {
        const currentSeat = await get(seat);
        if (generation !== presenceGeneration || currentSeat.val()?.token !== seatToken) return;

        if (activeDisconnect) {
          try {
            await activeDisconnect.cancel();
          } catch (error) {
            console.warn('이전 접속 종료 예약 해제 실패:', error);
          }
          activeDisconnect = null;
        }

        const disconnect = onDisconnect(seat);
        await disconnect.update({
          connected: false,
          lastSeenAt: serverTimestamp(),
        });

        if (generation !== presenceGeneration) {
          await disconnect.cancel();
          return;
        }

        activeDisconnect = disconnect;
        await update(seat, {
          connected: true,
          lastSeenAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn('접속 상태 복구 실패:', error);
      }
    },
    (error) => {
      console.warn('Firebase 연결 상태 감시 실패:', error);
    },
  );
}

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js';
import { firestore } from './firebase-client.js';

const DEFAULT_PROFILE = Object.freeze({
  nickname: '플레이어',
  totalWins: 0,
  totalLosses: 0,
  totalGames: 0,
  rating: 1000,
  currency: 0,
  preferences: {
    board: 'default',
    sleeve: 'default',
  },
});

function profileRef(uid) {
  return doc(firestore, 'users', uid);
}

export async function ensureProfile(user) {
  const ref = profileRef(user.uid);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    const initial = {
      ...DEFAULT_PROFILE,
      uid: user.uid,
      nickname: user.displayName?.trim() || DEFAULT_PROFILE.nickname,
      email: user.email || '',
      photoURL: user.photoURL || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, initial);
    return initial;
  }

  const current = snapshot.data();
  const profile = {
    ...DEFAULT_PROFILE,
    ...current,
    rating: Number(current.rating ?? current.rank ?? DEFAULT_PROFILE.rating),
    preferences: {
      ...DEFAULT_PROFILE.preferences,
      ...(current.preferences || {}),
    },
  };

  const identityPatch = {};
  if ((user.email || '') !== (current.email || '')) identityPatch.email = user.email || '';
  if ((user.photoURL || '') !== (current.photoURL || '')) identityPatch.photoURL = user.photoURL || '';
  if (Object.keys(identityPatch).length) {
    await setDoc(ref, { ...identityPatch, updatedAt: serverTimestamp() }, { merge: true });
  }

  return profile;
}

export async function getProfile(uid) {
  const snapshot = await getDoc(profileRef(uid));
  if (!snapshot.exists()) return null;
  const current = snapshot.data();
  return {
    ...DEFAULT_PROFILE,
    ...current,
    rating: Number(current.rating ?? current.rank ?? DEFAULT_PROFILE.rating),
    preferences: {
      ...DEFAULT_PROFILE.preferences,
      ...(current.preferences || {}),
    },
  };
}

export async function updateNickname(uid, nickname) {
  const cleanName = nickname.trim().slice(0, 12);
  if (!cleanName) throw new Error('닉네임을 입력하세요.');

  await runTransaction(firestore, async (transaction) => {
    const ref = profileRef(uid);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('프로필을 찾을 수 없습니다.');
    transaction.update(ref, { nickname: cleanName, updatedAt: serverTimestamp() });
  });

  return cleanName;
}

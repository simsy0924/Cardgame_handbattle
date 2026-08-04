const searchParams = new URLSearchParams(window.location.search);

export const APP_CONFIG = Object.freeze({
  appName: 'HAND BATTLE',
  schemaVersion: 1,
  roomCodeLength: 4,
  roomRoot: 'handbattleV2/rooms',
  sessionStorageKey: 'handbattle:v2:session',
  demoMode: searchParams.get('demo') === 'true',
  firebase: Object.freeze({
    apiKey: 'AIzaSyC-Qi2mzllnzwQKetxLy9BnepVEaugbUzA',
    authDomain: 'cardgame-1b151.firebaseapp.com',
    databaseURL: 'https://cardgame-1b151-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'cardgame-1b151',
    storageBucket: 'cardgame-1b151.firebasestorage.app',
    messagingSenderId: '179779519297',
    appId: '1:179779519297:web:634cdc2de3c866e09e57c0',
  }),
});

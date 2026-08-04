# HAND BATTLE 사이트 셸

기존 `Cardgame` 저장소의 분위기와 사용자 흐름을 참고해, **카드게임 엔진을 제외한 부분만** 새로 작성한 정적 웹 앱입니다.

## 포함된 기능

- Google 로그인과 사용자 프로필
- 닉네임 변경
- 4자리 온라인 방 생성·참가
- 호스트/게스트 대기실과 접속 상태
- 브라우저 새로고침 뒤 방 재접속
- AI 대전 진입점
- 튜토리얼과 개발 상태 안내
- 별도 카드게임 엔진을 연결하기 위한 `game-bridge.js`

## 의도적으로 제외한 기능

- 카드 데이터와 덱 빌더
- 턴, 단계, 효과, 체인, 공격 등 게임 규칙
- 게임 상태 네트워크 동기화
- 카드 지급, 스타터 덱, 카드 상점
- 관리자용 전적 초기화와 `FREE` 치트 코드

## 실행

빌드 과정이 없는 정적 사이트입니다. 로컬 서버 또는 GitHub Pages에서 `index.html`을 열면 됩니다.

```bash
python -m http.server 8000
```

ES module과 Firebase CDN을 사용하므로 `file://`로 직접 열지 말고 HTTP 서버를 사용하세요.

## 게임 엔진 연결

`js/game-bridge.js`의 `registerGameLauncher()`에 직접 만든 엔진 시작 함수를 등록합니다.

```js
import { registerGameLauncher } from './game-bridge.js';

registerGameLauncher(async (context, mountElement) => {
  // context.mode: 'online' | 'ai'
  // online일 때 roomCode, role, seatToken, players가 전달됩니다.
  mountElement.textContent = '여기에 게임 화면 렌더링';
});
```

등록하지 않으면 게임 영역에 전달된 컨텍스트만 표시하는 플레이스홀더가 나옵니다.

## Firebase

기존 사이트와 같은 Firebase 웹 프로젝트 설정을 사용하지만, Realtime Database 경로는 `handbattleV2/rooms`로 분리했습니다. 따라서 기존 `rooms` 데이터와 충돌하지 않습니다.

`firebase/` 폴더의 규칙은 시작점입니다. 실제 배포 전 Firebase Console 또는 CLI에서 적용하고, 게임 결과·재화처럼 조작 방지가 필요한 값은 클라이언트에서 쓰지 말고 신뢰할 수 있는 서버에서 처리해야 합니다.

## 구조

```text
index.html
css/app.css
js/
  app.js
  config.js
  game-bridge.js
  core/session.js
  services/firebase-client.js
  services/profile-service.js
  services/room-service.js
firebase/
  database.rules.json
  firestore.rules
```

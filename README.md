# Hand Battle

새 Android 앱으로 시작하는 Hand Battle 프로젝트입니다. 기존 웹 화면과 기존 카드 효과 코드는 새 구현에 포함하지 않았습니다.

## 현재 기반

- Kotlin + Jetpack Compose Android 앱
- 모바일 가로 화면
- 먼저 완성할 목표: 로컬 2인 대전
- 본덱 40–60장, 카드별 최대 4장
- 첫 패: 선공 6장, 후공 7장
- 승리 조건: 상대 패를 0장으로 만들기
- 카드 표시 문구와 효과 데이터 분리

현재 화면은 새 앱 셸이고, 대전 기능은 아직 연결하지 않았습니다. 규칙과 카드 효과를 작은 단위로 구현하면서 기능을 추가합니다.

## 빌드

JDK 17, Android SDK API 37, Android Gradle Plugin 9.4.0 및 Gradle 9.6.0이 필요합니다. Android Studio에서 프로젝트를 열거나, 환경이 준비된 뒤 다음 명령으로 디버그 APK를 만들 수 있습니다. GitHub Actions는 테스트와 디버그 APK 빌드를 실행하고 결과 APK를 아티팩트로 보관합니다.

```bash
gradle :app:assembleDebug
gradle :app:testDebugUnitTest
```

## 구조

```text
app/src/main/java/com/simsy/handbattle/
  MainActivity.kt
  game/CardRules.kt
```

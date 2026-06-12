# XShield 사용자 가이드

## 1. 설치

1. Chrome에서 `chrome://extensions`를 엽니다.
2. **Developer mode**를 켭니다.
3. **Load unpacked**를 클릭합니다.
4. `apps/extension/dist`를 선택합니다.
5. XShield를 Chrome 툴바에 고정합니다.

소스에서 빌드:

```bash
corepack enable
pnpm install
pnpm build
```

빌드 후 `apps/extension/dist`를 로드합니다.

## 2. 규칙 만들기

Dashboard의 **Rules**에서 감지 규칙을 만듭니다.

- `keyword`: 일반 키워드, 한 줄에 하나.
- `regex`: 정규식, 한 줄에 하나.
- 검사 필드: username, displayName, bio, content.
- Score: 규칙이 일치할 때 추가되는 위험 점수.

일치한 게시물은 연한 노란색으로 표시되고, 사용자는 후보 목록에 추가됩니다.

## 3. 후보 사용자 검토

**Candidate Users**에서 아바타, 프로필 링크, 소개, 팔로워 정보, 감지 이유를 확인합니다. 오탐은 화이트리스트에 추가하고, 확인된 대상은 차단 큐에 추가합니다.

## 4. 차단 큐 실행

- **Run Batch**: 설정된 배치 크기, 간격, 모드에 따라 실행합니다.
- **Manual Block Now**: 간격 제한을 무시하고 실행합니다. 너무 많은 사용자를 한 번에 차단하면 계정에 영향을 줄 수 있습니다.
- **Start/Stop**: 자동 큐를 일시 중지하거나 재개합니다.

## 5. 차단된 사용자 내보내기

**Blocked Users**에서 TXT, CSV, JSON, NDJSON, SQL 형식으로 내보낼 수 있습니다.

## 6. 실제 차단 모드 주의

실제 차단 모드는 Chrome의 현재 X/Twitter 로그인 세션에 의존합니다. X의 웹 API, 로그인 상태, CSRF 처리, 페이지 구조가 바뀌면 동작하지 않을 수 있습니다. 보수적인 배치 크기와 충분한 간격을 권장합니다.

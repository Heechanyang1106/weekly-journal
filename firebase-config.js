// Firebase 설정 파일
// ------------------------------------------------------------
// 아래가 null 이면 "로컬 모드"로 동작해요 (이 기기 브라우저에만 저장, 로그인 없음).
// 안내서(README.md) 2단계에서 복사한 firebaseConfig 내용을 붙여넣으면
// Google 로그인 + 폰·컴퓨터 동기화가 켜져요.
//
// 이 값들은 공개돼도 괜찮아요. 데이터는 firestore.rules(본인만 읽기/쓰기)로 보호돼요.

window.FIREBASE_CONFIG = null;

/* 붙여넣기 예시 — 위의 null 줄을 지우고 아래처럼 바꾸세요.

window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "my-weekly-journal.firebaseapp.com",
  projectId: "my-weekly-journal",
  storageBucket: "my-weekly-journal.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

*/

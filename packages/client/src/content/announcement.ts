export interface Announcement {
  readonly title: string;
  readonly body: string;
}

// Edit title/body below to change the lobby announcement. There is no admin
// UI or server for this yet (see CLAUDE.md "AI model asset deployment" /
// "Client static deployment" for the deploy pipeline) -- a content change
// only takes effect after `node packages/client/deploy.mjs` redeploys the
// client build.
export const announcement: Announcement = {
  title: 'V3.0 공지사항 (2026-10-06)',
  body: 'AI 모델이 V3.0으로 업데이트되었습니다. 티츄 콜 여부가 트릭 플레이에도 영향을 주도록 변경되었습니다. 성능 자체는 기존 V2.1 모델보다 개선된 것으로 확인했지만, 실제로 플레이 해 봤을 때 그렇게까지 성능이 좋아졌는지는 사실 잘 모르겠습니다... 문의가 있다면 아래 오픈채팅으로 연락 바랍니다.',
};

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
  title: 'V2.1 공지사항',
  body: '현재 트릭 플레이는 정책망 기반, 그 외에는 (패 교환 등) 휴리스틱 규칙에 의존하고 있습니다. 문의가 있다면 아래 오픈채팅으로 연락 바랍니다.',
};

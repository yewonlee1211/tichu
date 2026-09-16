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
  title: '공지사항',
  body: '티츄 온라인에 오신 것을 환영합니다! 현재는 AI와 연습하기 모드만 이용하실 수 있습니다.',
};

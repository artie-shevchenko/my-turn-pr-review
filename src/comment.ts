import { CommentBlock } from "./notMyTurnBlock";
import { Settings } from "./settings";
import { PR } from "./PR";

export class Comment {
  url: string;
  pr: PR;
  body: string;
  authorLogin: string;
  createdAtUnixMillis: number;
  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  constructor(
    url: string,
    pr: PR,
    body: string,
    authorLogin: string,
    createdAtUnixMillis: number,
  ) {
    this.url = url;
    this.pr = pr;
    this.body = body;
    this.authorLogin = authorLogin;
    this.createdAtUnixMillis = createdAtUnixMillis;
  }

  static of(v: Comment): Comment {
    return new Comment(
      v.url,
      v.pr,
      v.body,
      v.authorLogin,
      v.createdAtUnixMillis,
    );
  }

  isMyTurn(settings: Settings, commentBlocks: CommentBlock[]) {
    if (
      settings.getMinCommentCreateDate() > new Date(this.createdAtUnixMillis)
    ) {
      return false;
    }
    return !commentBlocks.some((block) => this.isBlockedBy(block));
  }

  isBlockedBy(block: CommentBlock) {
    return this.url === block.commentUrl;
  }
}

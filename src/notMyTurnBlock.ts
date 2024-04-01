// #NOT_MATURE: that's for PRs only, better rename.
export class NotMyTurnBlock {
  prUrl: string;
  lastReviewSubmittedUnixMillis: number;

  constructor(prUrl: string, lastReviewSubmittedUnixMillis: number) {
    this.prUrl = prUrl;
    this.lastReviewSubmittedUnixMillis = lastReviewSubmittedUnixMillis;
  }
}

export class CommentBlock {
  commentUrl: string;

  constructor(commentUrl: string) {
    this.commentUrl = commentUrl;
  }
}

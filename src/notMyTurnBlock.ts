// #NOT_MATURE: that's for PRs only, better rename.
export class NotMyTurnBlock {
  prUrl: string;
  lastReviewSubmittedUnixMillis: number;

  constructor(prUrl: string, lastReviewSubmittedUnixMillis: number) {
    this.prUrl = prUrl;
    this.lastReviewSubmittedUnixMillis = lastReviewSubmittedUnixMillis;
  }
}

// It's intentionally allowed only for some edge cases, like
// ReasonNotIgnored.LIKELY_JUST_SINGLE_COMMENT, see usages. In general blocking a review
// request is not a good idea.
export class NotMyTurnReviewRequestBlock {
  prUrl: string;
  reviewRequestedAtUnixMillis: number;

  constructor(prUrl: string, reviewRequestedAtUnixMillis: number) {
    this.prUrl = prUrl;
    this.reviewRequestedAtUnixMillis = reviewRequestedAtUnixMillis;
  }
}

export class CommentBlock {
  commentUrl: string;

  constructor(commentUrl: string) {
    this.commentUrl = commentUrl;
  }
}

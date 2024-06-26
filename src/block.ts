export class MyPrBlock {
  prUrl: string;
  lastReviewSubmittedUnixMillis: number;

  constructor(prUrl: string, lastReviewSubmittedUnixMillis: number) {
    this.prUrl = prUrl;
    this.lastReviewSubmittedUnixMillis = lastReviewSubmittedUnixMillis;
  }
}

// Either permanent or a temporary block (snooze).
// Block is intentionally allowed only for some edge cases, like
// ReasonNotIgnored.LIKELY_JUST_SINGLE_COMMENT, see usages. In general blocking a review
// request for an indefinite time is not a good idea.
export class ReviewRequestBlock {
  prUrl: string;
  // Strictly speaking it's reviewRequestedAtUnixMillisOrZero
  reviewRequestedAtUnixMillis: number;
  // defined for snooze only
  expireAtUnixMillis?: number;

  constructor(
    prUrl: string,
    reviewRequestedAtUnixMillisOrZero: number,
    expireAtUnixMillis?: number,
  ) {
    this.prUrl = prUrl;
    this.reviewRequestedAtUnixMillis = reviewRequestedAtUnixMillisOrZero;
    this.expireAtUnixMillis = expireAtUnixMillis;
  }
}

export class CommentBlock {
  commentUrl: string;

  constructor(commentUrl: string) {
    this.commentUrl = commentUrl;
  }
}

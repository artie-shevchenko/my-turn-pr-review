export class Settings {
  noPendingReviewsToBeMergeReady: boolean;
  commentEqualsChangesRequested: boolean;
  // See https://github.com/artie-shevchenko/my-turn-pr-review/issues/52
  singleCommentIsReview: boolean;
  // Non-negative. 0 means ignore all the comments.
  ignoreCommentsMoreThanXDaysOld: number;

  constructor(
    noPendingReviewsToBeMergeReady: boolean,
    commentEqualsChangesRequested: boolean,
    singleCommentIsReview: boolean,
    ignoreCommentsMoreThanXDaysOld: number,
  ) {
    this.noPendingReviewsToBeMergeReady = noPendingReviewsToBeMergeReady;
    this.commentEqualsChangesRequested = commentEqualsChangesRequested;
    this.singleCommentIsReview = singleCommentIsReview;
    this.ignoreCommentsMoreThanXDaysOld = ignoreCommentsMoreThanXDaysOld;
  }

  minCommentCreateDate: Date;

  // #NOT_MATURE: not thread-safe
  /** Memoized */
  getMinCommentCreateDate(): Date {
    if (this.minCommentCreateDate) {
      return this.minCommentCreateDate;
    }
    const result = new Date();
    result.setDate(result.getDate() - this.ignoreCommentsMoreThanXDaysOld);
    this.minCommentCreateDate = result;
    return result;
  }
}

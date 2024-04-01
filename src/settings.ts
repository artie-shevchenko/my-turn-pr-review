export class Settings {
  noPendingReviewsToBeMergeReady: boolean;
  commentEqualsChangesRequested: boolean;
  // Non-negative. 0 means ignore all the comments.
  ignoreCommentsMoreThanXDaysOld: number;

  constructor(
    noPendingReviewsToBeMergeReady: boolean,
    commentEqualsChangesRequested: boolean,
    ignoreCommentsMoreThanXDaysOld: number,
  ) {
    this.noPendingReviewsToBeMergeReady = noPendingReviewsToBeMergeReady;
    this.commentEqualsChangesRequested = commentEqualsChangesRequested;
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

export class Settings {
  noPendingReviewsToBeMergeReady: boolean;
  commentEqualsChangesRequested: boolean;

  constructor(
    noPendingReviewsToBeMergeReady: boolean,
    commentEqualsChangesRequested: boolean,
  ) {
    this.noPendingReviewsToBeMergeReady = noPendingReviewsToBeMergeReady;
    this.commentEqualsChangesRequested = commentEqualsChangesRequested;
  }
}

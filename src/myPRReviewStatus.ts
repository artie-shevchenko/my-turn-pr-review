// APPROVED or APPROVED_AND_COMMENTED possible only if reviewsRequested is empty.
export enum MyPRReviewStatus {
  // NONE stands for "Ball is still on the other side" (ignore this PR):
  NONE,
  CHANGES_REQUESTED,
  APPROVED,
  APPROVED_AND_COMMENTED,
  COMMENTED,
}

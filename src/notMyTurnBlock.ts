export class NotMyTurnBlock {
  prUrl: string;
  lastReviewSubmittedUnixMillis: number;

  constructor(prUrl: string, lastReviewSubmittedUnixMillis: number) {
    this.prUrl = prUrl;
    this.lastReviewSubmittedUnixMillis = lastReviewSubmittedUnixMillis;
  }
}

import { ReviewState } from "./reviewState";
import { PR } from "./PR";

export class ReviewOnMyPR {
  pr: PR;
  reviewerId: number;
  state: ReviewState;
  submittedAtUnixMillis: number;

  constructor(
    pr: PR,
    reviewerId: number,
    state: ReviewState,
    submittedAtUnixMillis: number,
  ) {
    this.pr = pr;
    this.reviewerId = reviewerId;
    this.state = state;
    this.submittedAtUnixMillis = submittedAtUnixMillis;
  }
}

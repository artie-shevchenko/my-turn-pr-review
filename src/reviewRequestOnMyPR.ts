import { PR } from "./PR";

export class ReviewRequestOnMyPR {
  pr: PR;
  reviewerId: number;

  constructor(pr: PR, reviewerId: number) {
    this.pr = pr;
    this.reviewerId = reviewerId;
  }

  static of(v: ReviewRequestOnMyPR): ReviewRequestOnMyPR {
    return new ReviewRequestOnMyPR(v.pr, v.reviewerId);
  }
}

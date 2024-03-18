import { PR } from "./PR";

export class ReviewRequest {
  pr: PR;
  // normally that's exactly when the review was requested but as a fallback it may use the time
  // when Chrome extension first observed this request:
  firstTimeObservedUnixMillis: number;
  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  constructor(pr: PR, firstTimeObservedUnixMillis: number) {
    this.pr = pr;
    this.firstTimeObservedUnixMillis = firstTimeObservedUnixMillis;
  }

  static of(v: ReviewRequest): ReviewRequest {
    return new ReviewRequest(v.pr, v.firstTimeObservedUnixMillis);
  }
}

import { ReviewRequestBlock } from "./block";
import { Settings } from "./settings";
import { PR } from "./PR";

export enum ReasonNotIgnored {
  // See https://github.com/artie-shevchenko/my-turn-pr-review/issues/52
  LIKELY_JUST_SINGLE_COMMENT,
}

export class ReviewRequest {
  pr: PR;
  // #NOT_MATURE: that's basically reviewRequestedAtUnixMillis (it used to be more complicated in
  // the past):
  /* Is undefined for team review request. */
  firstTimeObservedUnixMillis?: number;
  reasonNotIgnored?: ReasonNotIgnored;
  // if present then it's a review request for my team, not for me personally:
  teamName?: string;
  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName?: string;

  constructor(
    pr: PR,
    firstTimeObservedUnixMillis?: number,
    reasonNotIgnored?: ReasonNotIgnored,
    teamName?: string,
  ) {
    this.pr = pr;
    this.firstTimeObservedUnixMillis = firstTimeObservedUnixMillis;
    this.reasonNotIgnored = reasonNotIgnored;
    this.teamName = teamName;
  }

  /* Is undefined for team review request (or if it was originally a team review request). */
  reviewRequestedAtUnixMillis() {
    return this.firstTimeObservedUnixMillis;
  }

  reviewRequestedAtUnixMillisOrZero() {
    return this.firstTimeObservedUnixMillis
      ? this.firstTimeObservedUnixMillis
      : 0;
  }

  static of(v: ReviewRequest): ReviewRequest {
    return new ReviewRequest(
      v.pr,
      v.firstTimeObservedUnixMillis,
      v.reasonNotIgnored,
      v.teamName,
    );
  }

  isMyTurn(reviewRequestBlocks: ReviewRequestBlock[], settings: Settings) {
    if (
      settings.singleCommentIsReview &&
      this.reasonNotIgnored === ReasonNotIgnored.LIKELY_JUST_SINGLE_COMMENT
    ) {
      return false;
    }

    return !reviewRequestBlocks.some((block) => this.isBlockedBy(block));
  }

  isBlockedBy(block: ReviewRequestBlock): boolean {
    return (
      this.reviewRequestedAtUnixMillisOrZero() ===
        block.reviewRequestedAtUnixMillis &&
      this.pr.url === block.prUrl &&
      (!block.expireAtUnixMillis ||
        block.expireAtUnixMillis > new Date().getTime())
    );
  }

  isTeamReviewRequest(): boolean {
    return this.teamName !== undefined;
  }
}

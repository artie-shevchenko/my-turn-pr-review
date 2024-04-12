import { NotMyTurnReviewRequestBlock } from "./notMyTurnBlock";
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
  firstTimeObservedUnixMillis: number;
  reasonNotIgnored: ReasonNotIgnored | undefined;
  // if present then it's a review request for my team, not for me personally:
  teamName: string | undefined;
  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  constructor(
    pr: PR,
    firstTimeObservedUnixMillis: number,
    reasonNotIgnored = undefined as ReasonNotIgnored,
  ) {
    this.pr = pr;
    this.firstTimeObservedUnixMillis = firstTimeObservedUnixMillis;
    this.reasonNotIgnored = reasonNotIgnored;
  }

  reviewRequestedAtUnixMillis() {
    return this.firstTimeObservedUnixMillis;
  }

  static of(v: ReviewRequest): ReviewRequest {
    return new ReviewRequest(
      v.pr,
      v.firstTimeObservedUnixMillis,
      v.reasonNotIgnored,
    );
  }

  isMyTurn(
    notMyTurnReviewRequestBlocks: NotMyTurnReviewRequestBlock[],
    settings: Settings,
  ) {
    if (
      settings.singleCommentIsReview &&
      this.reasonNotIgnored === ReasonNotIgnored.LIKELY_JUST_SINGLE_COMMENT
    ) {
      return false;
    }

    return !notMyTurnReviewRequestBlocks.some((block) =>
      this.isBlockedBy(block),
    );
  }

  isBlockedBy(block: NotMyTurnReviewRequestBlock): boolean {
    return (
      this.reviewRequestedAtUnixMillis() ===
        block.reviewRequestedAtUnixMillis && this.pr.url === block.prUrl
    );
  }

  isTeamReviewRequest(): boolean {
    return this.teamName !== undefined;
  }
}

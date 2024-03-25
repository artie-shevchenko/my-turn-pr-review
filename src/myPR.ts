import { NotMyTurnBlock } from "./notMyTurnBlock";
import { PR } from "./PR";
import { ReviewState } from "./reviewState";
import { Settings } from "./settings";

export interface MyPrDto {
  pr: PR;
  reviewerStates: ReviewerState[];
}

export class MyPR implements MyPrDto {
  constructor(public pr: PR, public reviewerStates: ReviewerState[]) {}

  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  static ofGitHubResponses(
    pr: PR,
    reviewsReceived: ReviewOnMyPR[],
    reviewsRequested: ReviewRequestOnMyPR[],
    myUserId: number,
  ): MyPR {
    // will be overriden later:
    let lastReviewSubmittedUnixMillis = 0;
    reviewsReceived.sort(
      (a, b) => a.submittedAtUnixMillis - b.submittedAtUnixMillis,
    );
    const reviewerIds = new Set<number>();
    // Map them by reviewer ID:
    const reviewByReviewerId = new Map<number, ReviewOnMyPR[]>();
    for (const review of reviewsReceived) {
      let list = reviewByReviewerId.get(review.reviewerId);
      if (!list) {
        list = [];
        reviewByReviewerId.set(review.reviewerId, list);
      }
      list.push(review);
      reviewerIds.add(review.reviewerId);
      lastReviewSubmittedUnixMillis = Math.max(
        lastReviewSubmittedUnixMillis,
        review.submittedAtUnixMillis,
      );
    }

    const reviewRequestByReviewerId = new Map<number, ReviewRequestOnMyPR>();
    for (const reviewRequested of reviewsRequested) {
      reviewRequestByReviewerId.set(
        reviewRequested.reviewerId,
        reviewRequested,
      );
      reviewerIds.add(reviewRequested.reviewerId);
    }

    const reviewerStateBuilder = [] as ReviewerState[];
    for (const reviewerId of reviewerIds) {
      if (reviewerId === myUserId) {
        continue;
      }

      if (reviewRequestByReviewerId.get(reviewerId)) {
        reviewerStateBuilder.push(
          new ReviewerState(reviewerId, ReviewState.REQUESTED),
        );
        continue;
      }

      const sortedReviews = reviewByReviewerId.get(reviewerId);
      // Same as visualized in GitHub UI:
      const lastReviewState = sortedReviews
        .map((r) => r.state)
        .reduce((result, currentState) => {
          if (result == null) {
            // That's the only way it can become COMMENTED:
            return currentState;
          } else {
            if (
              currentState === ReviewState.APPROVED ||
              currentState === ReviewState.CHANGES_REQUESTED
            ) {
              return currentState;
            } else {
              // Preserve the current state:
              return result;
            }
          }
        }, null);
      reviewerStateBuilder.push(
        new ReviewerState(
          reviewerId,
          lastReviewState,
          sortedReviews[sortedReviews.length - 1].submittedAtUnixMillis,
        ),
      );
    }
    return new MyPR(pr, reviewerStateBuilder);
  }

  /** Returns null if no reviews requested or submitted. */
  getLastReviewSubmittedUnixMillis(): number {
    if (this.reviewerStates.length === 0) {
      return null;
    }
    return Math.max(...this.reviewerStates.map((v) => v.submittedAtUnixMillis));
  }

  isBlockedBy(block: NotMyTurnBlock) {
    let lastReviewSubmittedUnixMillis = 0;
    for (const reviewerState of this.reviewerStates) {
      lastReviewSubmittedUnixMillis = Math.max(
        lastReviewSubmittedUnixMillis,
        reviewerState.submittedAtUnixMillis,
      );
    }
    return (
      this.pr.url === block.prUrl &&
      block.lastReviewSubmittedUnixMillis >= lastReviewSubmittedUnixMillis
    );
  }

  isMyTurn(notMyTurnBlocks: NotMyTurnBlock[], settings: Settings): boolean {
    const status = this.getStatus(notMyTurnBlocks, settings);
    // noinspection RedundantIfStatementJS
    if (
      status === MyPRReviewStatus.NONE ||
      status === MyPRReviewStatus.COMMENTED
    ) {
      return false;
    } else {
      return true;
    }
  }

  getStatus(
    notMyTurnBlocks: NotMyTurnBlock[],
    settings: Settings,
  ): MyPRReviewStatus {
    if (this.reviewerStates.length === 0) {
      return MyPRReviewStatus.NONE;
    }

    if (notMyTurnBlocks.some((block) => this.isBlockedBy(block))) {
      return MyPRReviewStatus.NONE;
    }

    const states = [] as ReviewState[];
    this.reviewerStates.forEach((reviewerState) => {
      let state = reviewerState.state;
      if (
        settings.commentEqualsChangesRequested &&
        state === ReviewState.COMMENTED
      ) {
        state = ReviewState.CHANGES_REQUESTED;
      }
      states.push(state);
    });
    if (states.every((state) => state === ReviewState.REQUESTED)) {
      return MyPRReviewStatus.NONE;
    } else if (
      states.some((state) => state === ReviewState.CHANGES_REQUESTED)
    ) {
      return MyPRReviewStatus.CHANGES_REQUESTED;
    } else if (
      states.some((state) => state === ReviewState.REQUESTED) &&
      settings.noPendingReviewsToBeMergeReady
    ) {
      return MyPRReviewStatus.NONE;
    } else if (states.every((state) => state === ReviewState.COMMENTED)) {
      // what else can it mean? Other scenarios seem to be rare.
      return MyPRReviewStatus.CHANGES_REQUESTED;
    } else if (states.some((state) => state === ReviewState.COMMENTED)) {
      if (states.some((state) => state === ReviewState.APPROVED)) {
        return MyPRReviewStatus.APPROVED_AND_COMMENTED;
      } else {
        return MyPRReviewStatus.COMMENTED;
      }
    } else {
      return MyPRReviewStatus.APPROVED;
    }
  }

  static fromDto(v: MyPrDto): MyPR {
    return new MyPR(v.pr, v.reviewerStates ? v.reviewerStates : []);
  }
}

class ReviewerState {
  reviewerId: number;
  state: ReviewState;
  submittedAtUnixMillis: number;

  constructor(
    reviewerId: number,
    state: ReviewState,
    // For ReviewState#REQUESTED leave it empty:
    submittedAtUnixMillis = 0,
  ) {
    this.reviewerId = reviewerId;
    this.state = state;
    this.submittedAtUnixMillis = submittedAtUnixMillis;
  }
}

// APPROVED or APPROVED_AND_COMMENTED possible only if reviewsRequested is empty.
export enum MyPRReviewStatus {
  // NONE stands for "Ball is still on the other side" (ignore this PR):
  NONE,
  CHANGES_REQUESTED,
  APPROVED,
  APPROVED_AND_COMMENTED,
  COMMENTED,
}

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

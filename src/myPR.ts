import { MyPRReviewStatus } from "./myPRReviewStatus";
import { ReviewRequestOnMyPR } from "./reviewRequestOnMyPR";
import { ReviewState } from "./reviewState";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { PR } from "./PR";
import { ReviewOnMyPR } from "./reviewOnMyPR";

export class MyPR {
  pr: PR;
  reviewerStates: ReviewerState[];

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

  constructor(pr: PR, reviewerStates: ReviewerState[]) {
    this.pr = pr;
    this.reviewerStates = reviewerStates;
  }

  getLastReviewSubmittedUnixMillis(): number {
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

  getStatus(notMyTurnBlocks: NotMyTurnBlock[]): MyPRReviewStatus {
    if (notMyTurnBlocks.some((block) => this.isBlockedBy(block))) {
      return MyPRReviewStatus.NONE;
    }

    const states = [] as ReviewState[];
    this.reviewerStates.forEach((reviewerState) => {
      states.push(reviewerState.state);
    });

    if (states.every((state) => state === ReviewState.CHANGES_REQUESTED)) {
      return MyPRReviewStatus.NONE;
    } else if (
      states.some((state) => state === ReviewState.CHANGES_REQUESTED)
    ) {
      return MyPRReviewStatus.CHANGES_REQUESTED;
    } else if (states.some((state) => state === ReviewState.COMMENTED)) {
      if (states.some((state) => state === ReviewState.APPROVED)) {
        if (states.some((state) => state === ReviewState.REQUESTED)) {
          return MyPRReviewStatus.COMMENTED;
        } else {
          return MyPRReviewStatus.APPROVED_AND_COMMENTED;
        }
      } else {
        return MyPRReviewStatus.COMMENTED;
      }
    } else {
      if (states.some((state) => state === ReviewState.REQUESTED)) {
        return MyPRReviewStatus.NONE;
      } else {
        return MyPRReviewStatus.APPROVED;
      }
    }
  }

  static of(v: MyPR): MyPR {
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

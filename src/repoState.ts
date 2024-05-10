import { CommentBlock, MyPrBlock, ReviewRequestBlock } from "./notMyTurnBlock";
import { SyncStatus } from "./reposState";
import { RepoSyncResult } from "./repoSyncResult";
import { Settings } from "./settings";

export class RepoState {
  readonly fullName: string;
  lastSyncResult: RepoSyncResult;
  // Undefined if there were no successful syncs.
  lastSuccessfulSyncResult: RepoSyncResult;

  constructor(
    repoFullName: string = undefined,
    lastSyncResult: RepoSyncResult = undefined,
    lastSuccessfulSyncResult: RepoSyncResult = undefined,
  ) {
    this.fullName = repoFullName;
    this.lastSyncResult = lastSyncResult;
    this.lastSuccessfulSyncResult = lastSuccessfulSyncResult;
  }

  getSyncStatus(
    notMyTurnBlocks: MyPrBlock[],
    notMyTurnReviewRequestBlocks: ReviewRequestBlock[],
    commentBlocks: CommentBlock[],
    settings: Settings,
    lastSyncDurationMillis: number,
  ): SyncStatus {
    if (!this.hasRecentSuccessfulSync(lastSyncDurationMillis)) {
      return SyncStatus.Grey;
    }

    let requestsForMyReviewStatus: SyncStatus;
    if (
      this.lastSuccessfulSyncResult.requestsForMyReview.some(
        (reviewRequest) =>
          reviewRequest.isMyTurn(notMyTurnReviewRequestBlocks, settings) &&
          !reviewRequest.isTeamReviewRequest(),
      )
    ) {
      requestsForMyReviewStatus = SyncStatus.Red;
    } else if (
      this.lastSuccessfulSyncResult.requestsForMyReview.some(
        (reviewRequest) =>
          reviewRequest.isMyTurn(notMyTurnReviewRequestBlocks, settings) &&
          reviewRequest.isTeamReviewRequest(),
      )
    ) {
      requestsForMyReviewStatus = SyncStatus.Yellow;
    } else {
      requestsForMyReviewStatus = SyncStatus.Green;
    }
    // Yellow max based on myPRs. TODO(36): make it user-configurable:
    const myPRsStatus = this.lastSuccessfulSyncResult.myPRs.some((pr) =>
      pr.isMyTurn(notMyTurnBlocks, settings),
    )
      ? SyncStatus.Yellow
      : SyncStatus.Green;
    // Yellow max based on myPRs. TODO(36): make it user-configurable:
    let commentsStatus;
    if (settings.ignoreCommentsMoreThanXDaysOld > 0) {
      commentsStatus =
        this.lastSuccessfulSyncResult.comments.filter((c) =>
          c.isMyTurn(settings, commentBlocks),
        ).length > 0
          ? SyncStatus.Yellow
          : SyncStatus.Green;
    } else {
      commentsStatus = SyncStatus.Green;
    }
    return Math.max(requestsForMyReviewStatus, myPRsStatus, commentsStatus);
  }

  hasRecentSuccessfulSync(lastSyncDurationMillis: number): boolean {
    return (
      this.lastSuccessfulSyncResult &&
      this.lastSuccessfulSyncResult.isRecent(lastSyncDurationMillis)
    );
  }

  // Probably better replaced with a dto interface. See
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repoState: RepoState): RepoState {
    return new RepoState(
      repoState.fullName,
      RepoSyncResult.of(repoState.lastSyncResult),
      repoState.lastSuccessfulSyncResult
        ? RepoSyncResult.of(repoState.lastSuccessfulSyncResult)
        : undefined,
    );
  }
}

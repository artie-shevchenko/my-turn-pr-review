import { MyPRReviewStatus } from "./myPRReviewStatus";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { RepoSyncResult } from "./repoSyncResult";
import { SyncStatus } from "./github";

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

  getStatus(notMyTurnBlocks: NotMyTurnBlock[]): SyncStatus {
    if (!this.hasRecentSuccessfulSync()) {
      return SyncStatus.Grey;
    }

    const requestsForMyReviewStatus =
      this.lastSuccessfulSyncResult.requestsForMyReview.length > 0
        ? SyncStatus.Red
        : SyncStatus.Green;
    // Yellow max based on myPRs. TODO(36): make it user-configurable:
    const myPRsStatus = this.lastSuccessfulSyncResult.myPRs.some(
      (pr) => pr.getStatus(notMyTurnBlocks) != MyPRReviewStatus.NONE,
    )
      ? SyncStatus.Yellow
      : SyncStatus.Green;
    return Math.max(requestsForMyReviewStatus, myPRsStatus);
  }

  hasRecentSuccessfulSync(): boolean {
    return (
      this.lastSuccessfulSyncResult && this.lastSuccessfulSyncResult.isRecent()
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

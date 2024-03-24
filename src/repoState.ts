import { RepoType } from "./repo";
import { SyncStatus } from "./reposState";
import { Settings } from "./settings";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { RepoSyncResult } from "./repoSyncResult";

export class RepoState {
  readonly repoType: RepoType;
  readonly fullName: string;
  lastSyncResult: RepoSyncResult;
  // Undefined if there were no successful syncs.
  lastSuccessfulSyncResult: RepoSyncResult;

  constructor(
    repoType: RepoType,
    repoFullName: string,
    lastSyncResult: RepoSyncResult = undefined,
    lastSuccessfulSyncResult: RepoSyncResult = undefined,
  ) {
    this.repoType = repoType;
    this.fullName = repoFullName;
    this.lastSyncResult = lastSyncResult;
    this.lastSuccessfulSyncResult = lastSuccessfulSyncResult;
  }

  getSyncStatus(
    notMyTurnBlocks: NotMyTurnBlock[],
    settings: Settings,
  ): SyncStatus {
    if (!this.hasRecentSuccessfulSync()) {
      return SyncStatus.Grey;
    }

    const requestsForMyReviewStatus =
      this.lastSuccessfulSyncResult.requestsForMyReview.length > 0
        ? SyncStatus.Red
        : SyncStatus.Green;
    // Yellow max based on myPRs. TODO(36): make it user-configurable:
    const myPRsStatus = this.lastSuccessfulSyncResult.myPRs.some((pr) =>
      pr.isMyTurn(notMyTurnBlocks, settings),
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
      repoState.repoType ? repoState.repoType : RepoType.GITHUB,
      repoState.fullName,
      RepoSyncResult.of(repoState.lastSyncResult),
      repoState.lastSuccessfulSyncResult
        ? RepoSyncResult.of(repoState.lastSuccessfulSyncResult)
        : undefined,
    );
  }
}

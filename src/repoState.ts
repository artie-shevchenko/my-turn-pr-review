import { RepoType } from "./repo";
import { SyncStatus } from "./reposState";
import { Settings } from "./settings";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { RepoSyncResult } from "./repoSyncResult";

export class RepoStateDto {
  public readonly repoType: RepoType;
  public readonly fullName: string;
  public lastSyncResult?: RepoSyncResult;
  public lastSuccessfulSyncResult?: RepoSyncResult;
}

export class RepoState implements RepoStateDto {
  constructor(
    public readonly repoType: RepoType,
    public readonly fullName: string,
    public lastSyncResult?: RepoSyncResult,
    // Undefined if there were no successful syncs.
    public lastSuccessfulSyncResult?: RepoSyncResult,
  ) {}

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

  static fromDto(dto: RepoStateDto): RepoState {
    return new RepoState(
      dto.repoType ? dto.repoType : RepoType.GITHUB,
      dto.fullName,
      RepoSyncResult.fromDto(dto.lastSyncResult),
      dto.lastSuccessfulSyncResult
        ? RepoSyncResult.fromDto(dto.lastSuccessfulSyncResult)
        : undefined,
    );
  }
}

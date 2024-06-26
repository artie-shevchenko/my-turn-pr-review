import { CommentBlock, MyPrBlock, ReviewRequestBlock } from "./block";
import { Repo } from "./repo";
import { RepoState } from "./repoState";
import { Settings } from "./settings";
import {
  getCommentBlockList,
  getLastSyncDurationMillis,
  getMonitoringEnabledRepos,
  getMyPrBlockList,
  getReviewRequestBlockList,
  getSettings,
} from "./storage";

export enum SyncStatus {
  Green = -1,
  Yellow = 0,
  Red = 1,
  Grey = 2,
}

export class ReposState {
  repoStateByFullName: Map<string, RepoState>;

  constructor(repoStateByFullName: Map<string, RepoState>) {
    this.repoStateByFullName = repoStateByFullName;
  }

  async updateIcon(
    monitoringEnabledRepos?: Repo[],
    myPrBlocks?: MyPrBlock[],
    reviewRequestBlocks?: ReviewRequestBlock[],
    commentBlocks?: CommentBlock[],
    settings?: Settings,
  ): Promise<SyncStatus> {
    if (!monitoringEnabledRepos) {
      monitoringEnabledRepos = await getMonitoringEnabledRepos();
    }
    if (!myPrBlocks) {
      myPrBlocks = await getMyPrBlockList();
    }
    if (!reviewRequestBlocks) {
      reviewRequestBlocks = await getReviewRequestBlockList();
    }
    if (!commentBlocks) {
      commentBlocks = await getCommentBlockList();
    }
    if (!settings) {
      settings = await getSettings();
    }
    const lastSyncDurationMillis = await getLastSyncDurationMillis();
    let syncStatus = SyncStatus.Green;
    for (const repo of monitoringEnabledRepos) {
      const repoState = this.repoStateByFullName.get(repo.fullName());
      if (
        !repoState ||
        !repoState.hasRecentSuccessfulSync(lastSyncDurationMillis)
      ) {
        syncStatus = SyncStatus.Grey;
        break;
      }

      if (
        settings.ignoreCommentsMoreThanXDaysOld >
        repoState.lastSuccessfulSyncResult.ignoredCommentsMoreThanXDaysOld
      ) {
        syncStatus = SyncStatus.Grey;
        break;
      }

      syncStatus = Math.max(
        syncStatus,
        repoState.getSyncStatus(
          myPrBlocks,
          reviewRequestBlocks,
          commentBlocks,
          settings,
          lastSyncDurationMillis,
        ),
      );
    }

    let iconName: string;
    if (syncStatus == SyncStatus.Grey) {
      iconName = "grey128.png";
    } else if (syncStatus == SyncStatus.Red) {
      iconName = "red128.png";
    } else if (syncStatus == SyncStatus.Yellow) {
      iconName = "yellow128.png";
    } else {
      iconName = "green128.png";
    }
    chrome.action.setIcon({
      path: "icons/" + iconName,
    });
    return syncStatus;
  }

  asArray() {
    return [...this.repoStateByFullName.values()];
  }
}

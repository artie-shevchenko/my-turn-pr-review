import { NotMyTurnBlock } from "./notMyTurnBlock";
import { Repo } from "./repo";
import { RepoState } from "./repoState";
import { Settings } from "./settings";
import {
  getMonitoringEnabledRepos,
  getNotMyTurnBlockList,
  getSettings,
} from "./storage";

export enum SyncStatus {
  Green = -1,
  Yellow = 0,
  Red = 1,
  Grey = 2,
}

export class ReposState {
  repoStateList: RepoState[];

  constructor(repoStateList: RepoState[]) {
    this.repoStateList = repoStateList;
  }

  async updateIcon(
    monitoringEnabledRepos: Repo[] = undefined,
    notMyTurnBlocks: NotMyTurnBlock[] = undefined,
    settings: Settings = undefined,
  ): Promise<SyncStatus> {
    if (!monitoringEnabledRepos) {
      monitoringEnabledRepos = await getMonitoringEnabledRepos();
    }
    if (!notMyTurnBlocks) {
      notMyTurnBlocks = await getNotMyTurnBlockList();
    }
    if (!settings) {
      settings = await getSettings();
    }
    let syncStatus = SyncStatus.Green;
    for (const repo of monitoringEnabledRepos) {
      const repoState = this.getState(repo);
      if (!repoState || !repoState.hasRecentSuccessfulSync()) {
        syncStatus = SyncStatus.Grey;
        break;
      }
      syncStatus = Math.max(
        syncStatus,
        repoState.getSyncStatus(notMyTurnBlocks, settings),
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
    return this.repoStateList;
  }

  getState(repo: Repo) {
    const matchingRepoStates = this.repoStateList.filter(
      (v) => v.fullName === repo.fullName() && v.repoType === repo.type,
    );
    if (matchingRepoStates.length === 0) {
      return undefined;
    }
    // TODO: assert matchingRepoStates.length === 1
    return matchingRepoStates[0];
  }
}

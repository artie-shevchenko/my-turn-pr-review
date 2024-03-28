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
  repoStateByFullName: Map<string, RepoState>;

  constructor(repoStateByFullName: Map<string, RepoState>) {
    this.repoStateByFullName = repoStateByFullName;
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
      const repoState = this.repoStateByFullName.get(repo.fullName());
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
    return [...this.repoStateByFullName.values()];
  }
}

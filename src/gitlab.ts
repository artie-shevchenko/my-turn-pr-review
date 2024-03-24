import { RepoSyncResult } from "./repoSyncResult";
import { RepoState } from "./repoState";

export let gitLabCallsCounter = 0;

export function resetGitLabCallsCounter() {
  gitLabCallsCounter = 0;
}

/**
 * @param repo The repo state will be updated as a result of the call.
 */
export async function syncGitLabRepo(repo: RepoState, myGitLabUserId: number) {
  // TODO(29): implement
  repo.lastSyncResult = new RepoSyncResult(
    [],
    [],
    Date.now(),
    "GitLab sync not implemented",
  );
  // to get rid of warning:
  console.log("gitLabUserId" + myGitLabUserId);
}

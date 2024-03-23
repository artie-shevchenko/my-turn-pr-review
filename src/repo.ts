export enum RepoType {
  GITHUB,
}

export class Repo {
  readonly type: RepoType;
  readonly owner: string;
  readonly name: string;
  /* User setting from the Options page: */
  monitoringEnabled: boolean;

  constructor(
    type: RepoType,
    owner: string,
    name: string,
    monitoringEnabled = true,
  ) {
    this.type = type;
    this.owner = owner;
    this.name = name;
    this.monitoringEnabled = monitoringEnabled;
  }

  // #NOT_MATURE: maybe this should be replaced with a dto interface:
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repo: Repo): Repo {
    return new Repo(
      repo.type ? repo.type : RepoType.GITHUB,
      repo.owner,
      repo.name,
      repo.monitoringEnabled,
    );
  }

  static fromFullName(
    fullName: string,
    repoType: RepoType,
    monitoringEnabled = true,
  ): Repo {
    const p = fullName.indexOf("/");
    if (p < 0) {
      window.alert(`Repo name should contain symbol '/'.`);
      throw new Error(`Repo name should contain symbol but found ${fullName}.`);
    }

    return new Repo(
      repoType,
      fullName.substring(0, p),
      fullName.substring(p + 1),
      monitoringEnabled,
    );
  }

  fullName(): string {
    return this.owner + "/" + this.name;
  }
}

export class GitHubUser {
  id: number;
  token: string;
  // lazily populated on every sync, no caching, these may change:
  login: string;
  teamIds: number[];

  constructor(id: number, token: string) {
    this.id = id;
    this.token = token;
  }
}

export class PR {
  url: string;
  name: string;
  // May be undefined for comments
  authorLogin: string | undefined;
  isDraft: boolean;

  constructor(
    url: string,
    name: string,
    authorLogin: string,
    isDraft: boolean = undefined,
  ) {
    this.url = url;
    this.name = name;
    this.authorLogin = authorLogin;
    this.isDraft = isDraft === true;
  }
}

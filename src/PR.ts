export class PR {
  url: string;
  name: string;
  isDraft: boolean;

  constructor(url: string, name: string, isDraft: boolean = undefined) {
    this.url = url;
    this.name = name;
    this.isDraft = isDraft === true;
  }
}

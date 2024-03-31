# My Turn - PR Review

## Getting started

### Installing and running

1. Clone the repository
2. Run `npm install`
3. Run `npm run start` for development mode, `npm run build` for production build
4. Add the extension to Chrome:
    1. Go to `chrome://extensions/`
    2. Enable the `Developer mode`
    3. Click on `Load unpacked`
    4. Choose the `dist` directory
5. You are good to go!

### Project structure

All TypeScript files are placed in `src` directory. There are few files already prepared for you:
- `contentScript.ts` - the [content script](https://developer.chrome.com/docs/extensions/mv3/content_scripts/) to be run in the context of selected web pages
- `serviceWorker.ts` - the [background script](https://developer.chrome.com/docs/extensions/mv3/service_workers/) usually used to initialize the extension and monitor events
- `storage.ts` - little helper utility to easily manage the extension's [storage](https://developer.chrome.com/docs/extensions/reference/storage/). In this particular project we are using *synced* storage area
- `popup.ts` and `options.ts` - per-page scripts

Style files are placed in `styles` directory. There you can find per-page stylesheets and `common.scss` with stylings common across the pages.
We also use [Normalize.css](https://necolas.github.io/normalize.css/) so your extensions look good and consistent wherever they are installed.

`static` directory includes all the files to be copied over to the final build. It consists of `manifest.json` defining our extension, `.html` pages and icon set.

### Pages

Currently, there are two pages: `popup.html` and `options.html`, which can be found in `static` directory. Both have corresponding script and style files at `src` and `styles` directories accordingly.

#### Popup

It's a default extension's page, visible after clicking on extension's icon in toolbar. According to the documentation:
> The popup cannot be smaller than 25x25 and cannot be larger than 800x600.

Read more [here](https://developer.chrome.com/docs/extensions/reference/browserAction/#popup).

#### Options

Options page shown by right-clicking the extension icon in the toolbar and selecting *Options*.

There are two available types of options pages: `full page` and `embedded`. By default it is set to `full page`. You can change that behaviour in the `manifest.json`:

```javascript
"open_in_tab": true // For `full page`
"open_in_tab": false // For `embedded`
```

Read more [here](https://developer.chrome.com/docs/extensions/mv3/options/).


### Content scripts

Content scripts are files that run in the context of web pages. They live in an isolated world (private execution environment), so they do not conflict with the page or other extensions' content sripts.

The content script can be *declared statically* or *programmatically injected*.

#### Static declaration (match patterns)

Statically declared scripts are registered in the manifest file under the `"content_scripts"` field. They all must specify corresponding [match patterns](https://developer.chrome.com/docs/extensions/mv3/match_patterns/). In this boilerplate, the content script will be injected under all URLs by default. You can change that behaviour in `manifest.json` file. 

You can edit the default content script at `src/contentScript.ts`.

#### Programmatic injection

You can also inject the scripts programmatically. It might come in handy when you want to inject the script only in response to certain events. You also need to set extra permissions in manifest file. Read more about programmatic injection [here](https://developer.chrome.com/docs/extensions/mv3/content_scripts/#programmatic).

#### Adding new content script

To add a new content script, create a new script file in `src` directory. You also need to create a new entry in the *webpack* config file - `webpack.common.js`:

```javascript
entry: {
  serviceWorker: './src/serviceWorker.ts',
  contentScript: './src/contentScript.ts',
  popup: './src/popup.ts',
  options: './src/options.ts',

  // New entry down here
  myNewContentScript: './src/myNewContentScript.ts',
},
```

In case of static declaration, you might also need to modify the manifest file.

### Service worker (*old background pages*)

*If you are coming from Manifest V2, you might want to read this page first: [Migrating from background pages to service workers](https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/).*

As per docs:

> Extensions are event-based programs used to modify or enhance the Chrome browsing experience. Events are browser triggers, such as navigating to a new page, removing a bookmark, or closing a tab. Extensions monitor these events using scripts in their background service worker, which then react with specified instructions.

The most common event you will listen to is `chrome.runtime.onInstalled`:

```typescript
chrome.runtime.onInstalled.addListener(async () => {
  // Here goes everything you want to execute after extension initialization
  console.log('Extension successfully installed!');
});
```

It is also the perfect (**and the only**) place to create a [context menu](https://developer.chrome.com/docs/extensions/reference/contextMenus/).

You can edit the service worker at `src/serviceWorker.ts`.

Read more about service workers [here](https://developer.chrome.com/docs/extensions/mv3/service_workers/).

## More resources

- [Welcome to Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [webpack documentation](https://webpack.js.org/concepts/)
- [The TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Sass Basics](https://sass-lang.com/guide)

// Template based on Private Tab by Infocatcher
// https://addons.mozilla.org/firefox/addon/private-tab

'use strict';

const WINDOW_LOADED = -1;
const WINDOW_CLOSED = -2;

const LOG_PREFIX = '[Page Title in URL Bar (mod by uaSad)] ';
const PREF_BRANCH = 'extensions.uaSad@PageTitleInURLBar.';
const PREF_FILE = 'chrome://uasadpagetitleinurlbar/content/defaults/preferences/prefs.js';
const STYLE_FILE = 'chrome://uasadpagetitleinurlbar/content/overlay.css';

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/AddonManager.jsm');
let console = (Cu.import('resource://gre/modules/devtools/Console.jsm', {})).console;

function install(params, reason) {
}
function uninstall(params, reason) {
	let _deletePrefsOnUninstall = prefs.get('deletePrefsOnUninstall', true);
	if (reason == ADDON_UNINSTALL && _deletePrefsOnUninstall)
		prefs.deletePrefsOnUninstall();
}
function startup(params, reason) {
	windowsObserver.init(reason);
}
function shutdown(params, reason) {
	windowsObserver.destroy(reason);
}

let pageTitleMap = new WeakMap();

let windowsObserver = {
	initialized: false,
	appVersion: 0,
	init: function(reason) {
		if (this.initialized)
			return;
		this.initialized = true;
		this.appVersion = parseFloat(Services.appinfo.platformVersion);
		if (this.appVersion < 24) {
			Cu.reportError(LOG_PREFIX + 'startup error: version');
			return;
		}
		prefs.init();
		_dbg = prefs.get('debug', false);
		this.windows.forEach(function(window) {
			this.initWindow(window, reason);
		}, this);
		Services.ww.registerNotification(this);
		this.loadStyles();
	},
	destroy: function(reason) {
		if (!this.initialized)
			return;
		this.initialized = false;
		Services.ww.unregisterNotification(this);
		this.windows.forEach(function(window) {
			this.destroyWindow(window, reason);
		}, this);
		if (reason != APP_SHUTDOWN) {
			this.unloadStyles();
		}
		prefs.destroy();
	},

	observe: function(subject, topic, data) {
		if (topic == 'domwindowopened') {
			subject.addEventListener('load', this, false);
		}
	},

	handleEvent: function(event) {
		switch (event.type) {
			case 'load':
				this.loadHandler(event);
				break;
		}
	},
	loadHandler: function(event) {
		let window = event.originalTarget.defaultView;
		window.removeEventListener('load', this, false);
		this.initWindow(window, WINDOW_LOADED);
	},

	initWindow: function(window, reason) {
		if (reason == WINDOW_LOADED && !this.isTargetWindow(window)) {
			return;
		}
		let {gURLBar} = window;
		if (gURLBar) {
			pageTitleMap.set(window, new PTChrome(window));
		}
		else {
			Cu.reportError(LOG_PREFIX + 'startup error: gURLBar');
		}
	},
	destroyWindow: function(window, reason) {
		window.removeEventListener('load', this, false); // Window can be closed before "load"
		if (reason == WINDOW_CLOSED && !this.isTargetWindow(window))
			return;
		if (reason != WINDOW_CLOSED) {
			// See resource:///modules/sessionstore/SessionStore.jsm
			// "domwindowclosed" => onClose() => "SSWindowClosing"
			// This may happens after our "domwindowclosed" notification!
			let pt = pageTitleMap.get(window);
			if (pt)
				pt.shutdown();
		}
	},

	get windows() {
		let windows = [];
		let ws = Services.wm.getEnumerator('navigator:browser');
		while (ws.hasMoreElements()) {
			let window = ws.getNext();
			//if (this.isTargetWindow(window))
				windows.push(window);
		}
		return windows;
	},
	isTargetWindow: function(window) {
		let {document} = window;
		/*let rs = document.readyState;
		// We can't touch document.documentElement in not yet loaded window!
		// See https://github.com/Infocatcher/Private_Tab/issues/61
		if (rs != 'interactive' && rs != 'complete')
			return false;*/
		let winType = document.documentElement.getAttribute('windowtype');
		return winType == 'navigator:browser';
	},

	prefChanged: function(pName, pVal) {
		if (pName == 'debug') {
			_dbg = pVal;
		}
	},

	_stylesLoaded: false,
	loadStyles: function() {
		if (this._stylesLoaded)
			return;
		this._stylesLoaded = true;
		let sss = this.sss;

		let cssURI = this.cssURI = this.makeCSSURI();
		if (!sss.sheetRegistered(cssURI, sss.USER_SHEET))
			sss.loadAndRegisterSheet(cssURI, sss.USER_SHEET);
	},
	unloadStyles: function() {
		if (!this._stylesLoaded)
			return;
		this._stylesLoaded = false;
		let sss = this.sss;
		if (sss.sheetRegistered(this.cssURI, sss.USER_SHEET))
			sss.unregisterSheet(this.cssURI, sss.USER_SHEET);
	},
	reloadStyles: function() {
		this.unloadStyles();
		this.loadStyles();
	},
	get sss() {
		delete this.sss;
		return this.sss = Cc['@mozilla.org/content/style-sheet-service;1']
			.getService(Ci.nsIStyleSheetService);
	},
	makeCSSURI: function() {
		return Services.io.newURI(STYLE_FILE, null, null);
	}
};

const xulNS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

function PTChrome(window) {
	this.init(window);
}

PTChrome.prototype = {
	window: null,
	nodeByName: null,
	currentURL: null,
	currentTitle: null,

	init: function(window) {
		this.window = window;
		let {gBrowser, gURLBar, document} = window;
		window.addEventListener('unload', this, false);

		//mark down the information of current theme
		document.documentElement.setAttribute('selectedSkin', Services.prefs.getCharPref('general.skins.selectedSkin'));
		AddonManager.getAddonByID(
			'{972ce4c6-7e08-4474-a285-3208198ce6fd}',
			function(addon) {
				let fxVer = parseInt(addon.version);
				let themeStyle;

				if (fxVer >= 25)
					themeStyle = 25;
				else if (fxVer >= 14)
					themeStyle = 14;
				else
					themeStyle = 4;

				document.documentElement.setAttribute('pageTitleThemeStyle', themeStyle);
			}
		);

		let insertAfter = function(elem, refElem, parent) {
			if (!parent)
				parent = refElem.parentNode;
			let next = refElem.nextSibling;
			if (next) {
				return parent.insertBefore(elem, next);
			}
			else {
				return parent.appendChild(elem);
			}
		}.bind(this);

		// urlbar-pagetitle
		let urlbarTextbox = document.getAnonymousElementByAttribute(gURLBar, 'anonid', 'textbox-input-box');
		let pageTitle = document.createElementNS(xulNS, 'textbox');
		pageTitle.setAttribute('id', 'urlbar-pagetitle');
		pageTitle.setAttribute('align', 'center');
		pageTitle.setAttribute('readonly', 'true');
		let urlbarDB = document.getElementById('urlbar-display-box');
		insertAfter(pageTitle, urlbarDB);

		// identity-icon-hostport-box
		let idBox = document.getElementById('identity-box');
		let idIconHostBox = document.createElementNS(xulNS, 'hbox');
		idIconHostBox.setAttribute('id', 'identity-icon-hostport-box');
		idIconHostBox.setAttribute('flex', '1');
		idIconHostBox.setAttribute('align', 'center');
		let idBoxLbl = document.getElementById('identity-icon-labels');
		insertAfter(idIconHostBox, idBoxLbl, idBox);

		let names = [
			'identity-icon-subdomain',
			'identity-icon-domain',
			'identity-icon-port'
		];
		for (let i = 0; i < names.length; i++) {
			let lbl = document.createElementNS(xulNS, 'label');
			lbl.setAttribute('id', names[i]);
			lbl.setAttribute('flex', '1');
			lbl.setAttribute('class', 'plain');
			lbl.setAttribute('crop', 'end');
			idIconHostBox.appendChild(lbl);
		}

		this.nodeByName = {
			pageTitle: document.getElementById('urlbar-pagetitle'),
			domainLabel: document.getElementById('identity-icon-domain'),
			subDomainLabel: document.getElementById('identity-icon-subdomain'),
			portLabel: document.getElementById('identity-icon-port')
		};


		let appcontent = document.getElementById('appcontent');
		if (appcontent)
			appcontent.addEventListener('DOMContentLoaded', this, false);
		gBrowser.tabContainer.addEventListener('TabAttrModified', this, false);
		gBrowser.tabContainer.addEventListener('TabSelect', this, false);

		this.updateTitleText();

		_dbg && console.log(LOG_PREFIX + 'PTChrome.init()');
	},
	destroy: function(event) {
		let {window} = this;
		let {gBrowser, gURLBar, document} = window;
		window.removeEventListener('unload', this, false);

		let appcontent = document.getElementById('appcontent');
		if (appcontent)
			appcontent.removeEventListener('DOMContentLoaded', this, false);
		gBrowser.tabContainer.removeEventListener('TabAttrModified', this, false);
		gBrowser.tabContainer.removeEventListener('TabSelect', this, false);

		document.documentElement.removeAttribute('selectedSkin');
		document.documentElement.removeAttribute('pageTitleThemeStyle');

		if (this.nodeByName.pageTitle)
			this.nodeByName.pageTitle.removeAttribute('nopagetitle');

		let pt = document.getElementById('urlbar-pagetitle');
		if (pt)
			pt.parentNode.removeChild(pt);

		let idIhBox = document.getElementById('identity-icon-hostport-box');
		if (idIhBox)
			idIhBox.parentNode.removeChild(idIhBox);

		pageTitleMap.delete(window);

		_dbg && console.log(LOG_PREFIX + 'PTChrome.destroy()');
	},
	shutdown: function() {
		this.destroy();

		_dbg && console.log(LOG_PREFIX + 'PTChrome.shutdown()');
	},

	handleEvent: function(event) {
		switch (event.type) {
			case 'unload':
				this.destroy(event);
				break;
			case 'DOMContentLoaded':
			case 'TabAttrModified':
			case 'TabSelect':
				this.updateTitleText(event);
				break;
		}

		_dbg && console.log(LOG_PREFIX + 'PTChrome.handleEvent()');
	},

	updateTitleText: function(event) {
		let {window} = this;
		let {gBrowser, document} = window;

		if (event) {
			let tab;
			if (event.type == 'DOMContentLoaded') {
				let domWindow = event.target.defaultView.top;
			    let tabIndex = gBrowser.getBrowserIndexForDocument(domWindow.document);
				tab = gBrowser.tabContainer.childNodes[tabIndex];
			}
			else if (['tab', 'window'].indexOf(event.target.localName) == -1) {
				return;
			}
			else {
				tab = event.target;
			}
			let aBrowser = tab.linkedBrowser;
			if (aBrowser.currentURI.spec !== gBrowser.currentURI.spec)
				return;
		}

		if (this.currentURL == gBrowser.currentURI.spec &&
			this.currentTitle == gBrowser.contentTitle)
			return;
		this.currentURL = gBrowser.currentURI.spec;
		this.currentTitle = gBrowser.contentTitle;

		let {mCurrentTab: tab} = gBrowser;
		let {mCurrentBrowser: browser} = gBrowser;
		let {pageTitle, domainLabel,
			subDomainLabel, portLabel} = this.nodeByName;

		if (!pageTitle)
			return;

		//clear the value of our stuffs
		pageTitle.value = '';
		subDomainLabel.value = '';
		domainLabel.value = '';
		portLabel.value = '';

		//get the fixed label of tab
		//if there is other extension provides the some feature please tell me
		let isLabelFixed = false;
		let fixedLabel = null;
		//Tab Mix Plus
		if ('TMP_TabView' in window) {
			isLabelFixed = tab.hasAttribute('fixed-label');
			fixedLabel = tab.getAttribute('fixed-label');
		//Tab Utilities
		}
		else if ('tabutils' in window) {
			isLabelFixed = tab.hasAttribute('title');
			fixedLabel = tab.getAttribute('title');
		//TabRenamizer
		}
		else if ('TabRenamizer' in window) {
			isLabelFixed = !!tab.tr_label;
			fixedLabel = tab.tr_label;
		}

		//get the page title and url
		let title = isLabelFixed ? fixedLabel : browser.contentTitle;
		let url = browser.currentURI.asciiSpec;

		//remove the prefix of ie tab and get the real url of page
		if (url.indexOf('chrome://ietab')  == 0)
			try {
				url = /((?:\?url=)|(?:\.xul#)).+/.exec(url)[0].replace(/\?url=|\.xul#/, '');
			}
			catch(e) {
				Cu.reportError(e);
			}

		try {
			//if the title is just the url, it is unnecessary to show our stuffs
			if (title == url) {
				title = null;
			//some about: pages does not show url in url bar but just waits for inputing url
			//so we keep the url bar in input mode
			}
			else if (['about:blank', 'about:newtab', 'about:home', 'about:privatebrowsing', 'about:sessionrestore']
					.indexOf(url) > -1 || url.indexOf('about:neterror') == 0) {
				title = null;
			//here is the right time for us to do something
			}
			else {
				pageTitle.value = title;

				let protocol = url.match(/^[a-z\d.+\-]+:(?=[^\d])/);

				//if it is not http or ftp, we show the protocol instead of domain in identity box
				if (['http:', 'https:', 'ftp:'].indexOf(protocol[0]) == -1) {
					domainLabel.value = protocol[0];
				//otherwise, we grab the domain name to show in identity box
				}
				else {
					//here is the code copied from the source of firefox
					let urlObj = Cc['@mozilla.org/network/io-service;1'].
							getService(Ci.nsIIOService).
							newURI(url, null, null).QueryInterface(Ci.nsIURL);

					let prePath = urlObj.prePath;
					let matchedURL = prePath.match(/^((?:[a-z]+:\/\/)?(?:[^\/]+@)?)(.+?)(?::\d+)?(?:\/|$)/);
					let [, preDomain, domain] = matchedURL;
					let baseDomain = domain;
					let subDomain = '';
					if (domain[0] != '[')
						try {
							baseDomain = Services.eTLD.getBaseDomainFromHost(domain);
						}
						catch (e) {}

					if (baseDomain != domain) {
						let segments = (function (s) s.replace(/[^.]*/g, '').length + 1);
						let subSegments = segments(domain) - segments(baseDomain);
						subDomain = domain.match(new RegExp('(?:[^.]*.){' + subSegments + '}'))[0];
					}

					subDomainLabel.value = subDomain;
					domainLabel.value = urlObj.host.substring(subDomain.length);
					portLabel.value = urlObj.port != -1 ? ':' + urlObj.port : '';
				}
			}
		//if error occurs, show the original url bar
		}
		catch (ex) {
			title = null;
			Cu.reportError(ex);
			//this.destroy();
		}

		//set the flag for css to control the visibility of our stuffs
		pageTitle.parentNode.setAttribute('nopagetitle', !title);

		_dbg && console.log(LOG_PREFIX + 'PTChrome.updateTitleText()');
	}
};

let prefs = {
	ns: PREF_BRANCH,
	initialized: false,
	init: function() {
		if (this.initialized)
			return;
		this.initialized = true;

		//~ todo: add condition when https://bugzilla.mozilla.org/show_bug.cgi?id=564675 will be fixed
		this.loadDefaultPrefs();
		Services.prefs.addObserver(this.ns, this, false);
	},
	destroy: function() {
		if (!this.initialized)
			return;
		this.initialized = false;

		Services.prefs.removeObserver(this.ns, this);
	},
	observe: function(subject, topic, pName) {
		if (topic != 'nsPref:changed')
			return;
		let shortName = pName.substr(this.ns.length);
		let val = this.getPref(pName);
		this._cache[shortName] = val;
		windowsObserver.prefChanged(shortName, val);
	},

	deletePrefsOnUninstall: function() {
		try {
			Services.prefs.deleteBranch(this.ns);
		}
		catch (ex) {
			console.error(LOG_PREFIX + ex);
		}

		_dbg && console.log(LOG_PREFIX + 'prefs.deletePrefsOnUninstall()');
 	},

	loadDefaultPrefs: function() {
		let defaultBranch = Services.prefs.getDefaultBranch('');
		let prefsFile = PREF_FILE;
		let prefs = this;
		let scope = {
			pref: function(pName, val) {
				let pType = defaultBranch.getPrefType(pName);
				if (pType != defaultBranch.PREF_INVALID && pType != prefs.getValueType(val)) {
					Cu.reportError(
						LOG_PREFIX + 'Changed preference type for "' + pName
						+ '", old value will be lost!'
					);
					defaultBranch.deleteBranch(pName);
				}
				prefs.setPref(pName, val, defaultBranch);
			}
		};
		Services.scriptloader.loadSubScript(prefsFile, scope);

		_dbg && console.log(LOG_PREFIX + 'prefs.loadDefaultPrefs()');
	},

	_cache: { __proto__: null },
	get: function(pName, defaultVal) {
		let cache = this._cache;
		return pName in cache
			? cache[pName]
			: (cache[pName] = this.getPref(this.ns + pName, defaultVal));
	},
	set: function(pName, val) {
		return this.setPref(this.ns + pName, val);
	},
	getPref: function(pName, defaultVal, prefBranch) {
		let ps = prefBranch || Services.prefs;
		switch (ps.getPrefType(pName)) {
			case ps.PREF_BOOL:
				return ps.getBoolPref(pName);
			case ps.PREF_INT:
				return ps.getIntPref(pName);
			case ps.PREF_STRING:
				return ps.getComplexValue(pName, Ci.nsISupportsString).data;
		}
		return defaultVal;
	},
	setPref: function(pName, val, prefBranch) {
		let ps = prefBranch || Services.prefs;
		let pType = ps.getPrefType(pName);
		if (pType == ps.PREF_INVALID)
			pType = this.getValueType(val);
		switch (pType) {
			case ps.PREF_BOOL:
				ps.setBoolPref(pName, val);
				break;
			case ps.PREF_INT:
				ps.setIntPref(pName, val);
				break;
			case ps.PREF_STRING:
				let ss = Ci.nsISupportsString;
				let str = Cc['@mozilla.org/supports-string;1']
					.createInstance(ss);
				str.data = val;
				ps.setComplexValue(pName, ss, str);
		}
		return this;
	},
	getValueType: function(val) {
		switch (typeof val) {
			case 'boolean':
				return Services.prefs.PREF_BOOL;
			case 'number':
				return Services.prefs.PREF_INT;
		}
		return Services.prefs.PREF_STRING;

	},
	has: function(pName) {
		return this._has(pName);
	},
	_has: function(pName) {
		let ps = Services.prefs;
		pName = this.ns + pName;
		return (ps.getPrefType(pName) != Ci.nsIPrefBranch.PREF_INVALID);
	},
	reset: function(pName) {
		if (this.has(pName))
			this._reset(pName);
	},
	_reset: function(pName) {
		let ps = Services.prefs;
		pName = this.ns + pName;
		try {
			ps.clearUserPref(pName);
		}
		catch (ex) {
			// The pref service throws NS_ERROR_UNEXPECTED when the caller tries
			// to reset a pref that doesn't exist or is already set to its default
			// value.  This interface fails silently in those cases, so callers
			// can unconditionally reset a pref without having to check if it needs
			// resetting first or trap exceptions after the fact.  It passes through
			// other exceptions, however, so callers know about them, since we don't
			// know what other exceptions might be thrown and what they might mean.
			if (ex.result != Cr.NS_ERROR_UNEXPECTED)
				throw ex;
		}
	}
};

// Be careful, loggers always works until prefs aren't initialized
// (and if "debug" preference has default value)
let _dbg = true;

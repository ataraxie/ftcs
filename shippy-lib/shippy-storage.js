
/**
 * The SessionStorage controller used by Shippy
 *
 * Exposes the interface specified as return statement to the module at the bottom.
 */
Shippy.Storage = (function() {

	/*
	 * This MIME types were extracted from:
	 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Complete_list_of_MIME_types
	 * However, this is not a comprehensive list
	 */
	let extToMimes = {
		'img': 'image/jpeg',
		'png': 'image/png',
		'css': 'text/css',
		'gif': 'image/gif',
		'htm': 'text/html',
		'html': 'text/html',
		'ico': 'image/x-icon',
		'jpeg': 'image/jpeg',
		'jpg': 'image/jpeg',
		'js': 'application/javascript',
		'json': 'application/json',
		'xml': 'application/xml',
		'default': 'text/plain',
		'woff': 'font/woff',
		'woff2': 'font/woff2',
		'ttf': 'font/ttf'
	};

	// Default path function to be used in addFiles if no preprocessing is required
	let defaultPath = function (file) {
		return file;
	};

	// Default key function to be used in addFiles if no preprocessing is required
	let defaultKey = function (file) {
		return '/'.concat(file);
	};

	// Converts a file to a MIME type
	function fileToMime(file) {
		let extension = file.split(".").pop();
		if (extToMimes.hasOwnProperty(extension)) {
			return extToMimes[extension];
		}
		return extToMimes.default;
	}

	// Adds a file to session storage
	function addFile(file, key, cacheEnabled) {
		cacheEnabled = cacheEnabled || false;
		// If you keep changing the js files, this may cause issues. That's why cacheEnabled is false by default
		// When we have a stable API/sytem, we can enable it to true later on
		if (cacheEnabled && sessionStorage.getItem(key)) {
			return;
		}

		// Creates a XMLHttpRequest to extract the content of files referenced through src or href into the index.html
		let xhr = new XMLHttpRequest(),
			fileReader = new FileReader();

		xhr.open("GET", file, true);
		xhr.responseType = "blob";

		// Wait the file to be loaded so we can extract its content
		xhr.addEventListener("load", function () {
			if (xhr.status === 200) {
				// onload needed since Google Chrome doesn't support addEventListener for FileReader
				fileReader.onload = function (evt) {
					let content = evt.target.result;
					let mimeType = fileToMime(file);
					let data = {mimeType: mimeType, content: content};

					try {
						sessionStorage.setItem(key, JSON.stringify(data));
					}
					catch (e) {
						Shippy.Util.log("Storage failed: ", e);
					}
				};
				// Encoding the file as Data URL makes it easier to serve different file types in the onFetch server function
				fileReader.readAsDataURL(xhr.response);
			}
		}, false);
		xhr.send();
	}

	// get one file from the session storage
	function get(key) {
		let file = sessionStorage.getItem(key);
		if (file) {
			return JSON.parse(file);
		}
		return null;
	}

	// Iterate and add files to the session storage based on functions with extract the data required to do so
	// Only add files which have a source path (src or href).
	function addFiles(fileList, getPath, getKey) {
		for (let file of fileList) {
			try {
				let path = getPath(file);
				if (typeof path !== 'undefined' && path !== "") {
					let key = getKey(file);

					addFile(path, key);
				}
			} catch (err){

			}
		}
	}

	// add script files to the session storage
	function addScripts() {
		let scripts = document.getElementsByTagName('script');
		let getPath = function (script) {
			return script.src;
		};
		let getKey = function (script) {
			// Workaround because of the frameworks that add #/ to the URI path
			let aux = script.baseURI.replace('#/', '');
			aux = '/'.concat(script.src.replace(aux, ''));
			return aux;
		};

		addFiles(scripts, getPath, getKey);
	}

	// add style sheet files to the session storage
	function addStyleSheets() {
		let styleSheets = document.styleSheets;
		let getPath = function (styleSheet) {
			return styleSheet.href;
		};
		let getKey = function (styleSheet) {
			// Workaround because of the frameworks that add #/ to the URI path
			let aux = styleSheet.ownerNode.baseURI.replace('#/', '');
			aux = '/'.concat(styleSheet.href.replace(aux, ''));
			return aux;
		};

		addFiles(styleSheets, getPath, getKey);
		addEmbeddedUrls(styleSheets);
	}

	function addEmbeddedUrls(styleSheets) {
		for (let styleSheet of styleSheets) {
			if (!!styleSheet.cssRules) {
				for (let rule of styleSheet.cssRules) {
					if (rule.style && rule.style.backgroundImage) {
						addCssBackgroundImage(rule.style.backgroundImage)
					}
				}
			}
		}
	}

	function addCssBackgroundImage(backgroundImage) {
		const urlRgx = /url\((.*?)\)/g;
		const urlPrefix = "url(\"".length;
		const urlSuffix = "\")".length;
		let matches = backgroundImage.match(urlRgx);
		if (!!matches) {
			let imgs = matches.map(function (img) {
				let aux = img.substring(urlPrefix, img.length - urlSuffix);
				if (aux.startsWith('data')) {
					return null;
				} else {
					let path = aux.split("/");
					path = path.filter(function (p) {
						return p !== '..';
					});
					return path.join("/");
				}
			}).filter(function (img) {
				return img !== null;
			});

			addFiles(imgs, defaultPath, defaultKey);
		}
	}

	function addHtmls() {
		let content = Shippy.internal.initialHtml();
		let data = {mimeType: extToMimes.html, content: content};
		sessionStorage.setItem('/', JSON.stringify(data));
		sessionStorage.setItem('/index.html', JSON.stringify(data));
		addImages(content);
	}

	function addImages(html) {
		// I need two regex because first I want to filter all images that have a src and then
		// another one to fetch only the content inside the source
		const imgRgx = /img(.*?)src=\"(.*?)\"/g;
		const srcRgx = /src=\"(.*?)\"/g;
		const srcPrefix = "src=\"".length;
		const srcSuffix = "\"".length;
		let matches = html.match(imgRgx);
		if (!!matches) {
			let imgs = matches.map(function (img) {
				let src = img.match(srcRgx);
				if (src) {
					let aux = src[0].substring(srcPrefix, src[0].length - srcSuffix);
					return aux.replace("\"", "");
				} else {
					return null;
				}
			}).filter(function (img) {
				return img !== null;
			});

			addFiles(imgs, defaultPath, defaultKey);
		}
	}

	function init() {
		addScripts();
		addStyleSheets();
		addHtmls();
	}

	return {
		get: get,
		init: init,
		extToMimes: extToMimes
	}
})();
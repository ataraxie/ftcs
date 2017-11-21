/**
 * The SessionStorage controller used by Shippy
 *
 * Exposes the interface specified as return statement to the module at the bottom.
 */
Shippy.Storage = (function () {

	/*
	 * This MIME types were extracted from:
	 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Complete_list_of_MIME_types
	 * However, this is not a comprehensive list
	 */
	var extToMimes = {
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

	// Converts a file to a MIME type
	function fileToMime(file) {
		var index = file.lastIndexOf('.');
		if (index !== -1) {
			var extension = file.substring(index + 1, file.length);
			if (extToMimes.hasOwnProperty(extension)) {
				return extToMimes[extension];
			}
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
		var xhr = new XMLHttpRequest(),
			fileReader = new FileReader();

		xhr.open("GET", file, true);
		xhr.responseType = "blob";

		// Wait the file to be loaded so we can extract its content
		xhr.addEventListener("load", function () {
			if (xhr.status === 200) {
				// onload needed since Google Chrome doesn't support addEventListener for FileReader
				fileReader.onload = function (evt) {
					var content = evt.target.result;
					var mimeType = fileToMime(file);
					var data = {mimeType: mimeType, content: content};

					try {
						sessionStorage.setItem(key, JSON.stringify(data));
						Lib.log('File successfully added to session storage', key);
					}
					catch (e) {
						Lib.log("Storage failed: ", e);
					}
				};
				fileReader.readAsText(xhr.response);
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
	function addFiles(fileList, getPath, getKey, validate) {
		for (let file of fileList) {
			if (validate(file)) {
				let key = getKey(file);
				let path = getPath(file);

				addFile(path, key);
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
			return '/'.concat(script.src.replace(script.baseURI, ''));
		};
		let validate = function (script) {
			return script.src !== "";
		};

		addFiles(scripts, getPath, getKey, validate);
	}

	// add style sheet files to the session storage
	function addStyleSheets() {
		var styleSheets = document.styleSheets;
		let getPath = function (styleSheet) {
			return styleSheet.href;
		};
		let getKey = function (styleSheet) {
			return '/'.concat(styleSheet.href.replace(styleSheet.ownerNode.baseURI, ''));
		};
		let validate = function (styleSheet) {
			return styleSheet.href;
		};

		addFiles(styleSheets, getPath, getKey, validate);
	}

	function addHtmls() {
		let content = Shippy.internal.initialHtml();
		// if this function is triggered before the internal initial content is loaded, it will keep rescheduling its execution to the next 1s
		// this may cause one infinite loop or other problems, but at least during testing everything worked fine
		if (content) {
			let data = {mimeType: extToMimes.html, content: content};
			sessionStorage.setItem('/', JSON.stringify(data));
			Lib.log('File successfully added to session storage', '/');
			sessionStorage.setItem('/index.html', JSON.stringify(data));
			Lib.log('File successfully added to session storage', '/index.html');
		} else {
			Lib.log('Initial HTML yet not loaded');
			setTimeout(addHtmls, 1000);
		}
	}

	function init() {
		addScripts();
		addStyleSheets();
		addHtmls();
	}

	return {
		get: get,
		init: init
	}
})();
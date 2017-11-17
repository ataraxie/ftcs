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

    /**
     * Converts a file to a MIME type
     * @param file
     * @returns string - MIME extension, e.g. 'image/jpeg' or 'application/json'
     */
    function fileToMime(file) {
        var index = file.lastIndexOf('.');
        if (index !== -1) {
            var extension = file.substring(index + 1, file.length);
            if (extToMimes.hasOwnProperty(extension)) {
                return extToMimes[extension];
            }
        }
        return extToMimes['default'];
    }

    function addFile(file, key) {
        // TODO: During development, this may cause cache issues. Better leave it commented for now
        // Refrains from loading files already in the session storage
        // if (sessionStorage.getItem(key)) {
        //     return;
        // }

        var xhr = new XMLHttpRequest(),
            fileReader = new FileReader();

        xhr.open("GET", file, true);
        xhr.responseType = "blob";

        xhr.addEventListener("load", function () {
            if (xhr.status === 200) {
                // onload needed since Google Chrome doesn't support addEventListener for FileReader
                fileReader.onload = function (evt) {
                    var content = evt.target.result;
                    var mimeType = fileToMime(file);

                    var data = {mimeType: mimeType, content: content};

                    try {
                        console.log("ship-storage updated with", key);
                        sessionStorage.setItem(key, JSON.stringify(data));
                    }
                    catch (e) {
                        console.log("Storage failed: " + e);
                    }
                };
                fileReader.readAsText(xhr.response);
            }
        }, false);
        xhr.send();
    }

    function get(key) {
        let file = sessionStorage.getItem(key);
        if (file) {
            return JSON.parse(file);
        }
        return null;
    }

    function addScripts() {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var script = scripts[i];
            var file = script.src.replace(script.baseURI, '');
            var key = '/'.concat(file);

            addFile(script.src, key);
        }
    }

    function addStyleSheets() {
        var styleSheets = document.styleSheets;
        for (var i = 0; i < styleSheets.length; i++) {
            var styleSheet = styleSheets[i];
            if (styleSheet.href) {
                var file = styleSheet.href.replace(styleSheet.ownerNode.baseURI, '');
                var key = '/'.concat(file);

                addFile(styleSheet.href, key);
            }
        }
    }

    function addHtmls() {
        let content = Shippy.internal.initialHtml();
        if (content) {
            let data = {mimeType: extToMimes['html'], content: content};
            sessionStorage.setItem('/', JSON.stringify(data));
            console.log("ship-storage updated with", '/');
            sessionStorage.setItem('/index.html', JSON.stringify(data));
            console.log("ship-storage updated with", '/index.html');
        } else {
            Lib.log('Initial HTML yet not loaded');
            setTimeout(addHtmls, 1000);
        }


        // // // default html page. Later on, if our FlyWeb server serves more html webpages, we could extend this function
        // var htmls = [{path: '/', file: 'index.html'}, {path: '/index.html', file: 'index.html'}];
        // for (var i = 0; i < htmls.length; i++) {
        //     var html = htmls[i];
        //
        //     var file = window.location.href;
        //     file = file.concat(html.file);
        //     var key = html.path;
        //
        //     addFile(file, key);
        // }
    }

    function bootstrap() {
        addScripts();
        addStyleSheets();
        addHtmls();
    }

    return {
        get: get,
        bootstrap: bootstrap
    }
})();
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('enableButton').addEventListener('click', function () {
            if (!('Notification' in window)) {
                console.log('Web Notification not supported');
                return;
            }

            Notification.requestPermission(function (permission) {
                var notification = new Notification("CPSC Queue App", {
                    body: "Notifications enabled!",
                    dir: 'auto'
                });
                setTimeout(function () {
                    notification.close();
                }, 20000);
            });
        });
    });
})();
// Google Analytics (GA4) for yoahka.com: page views on every page and game, plus a few game events.
// Games call window.track('room_create') etc.; each event is tagged with which game it came from.
(function () {
    var ID = 'G-04GNC61G4Z';
    var local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

    // Never count local testing
    if (local) {
        window.track = function () {};
        return;
    }

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ID);

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);

    // First folder of the URL: "race", "eyes", "tanks"... or "site" for the main pages
    var first = location.pathname.split('/').filter(Boolean)[0] || '';
    var game = /\.html$/.test(first) || !first ? 'site' : first;

    window.track = function (name, params) {
        try {
            var p = { game: game };
            for (var k in params || {}) p[k] = params[k];
            window.gtag('event', name, p);
        } catch (e) { /* analytics must never break a game */ }
    };
})();

// Shared site chrome: theme, header and footer.
// Loaded in <head> so the saved theme applies before the page paints.
(function () {
    const root = document.documentElement;

    function storedTheme() {
        try { return localStorage.getItem('theme'); } catch (e) { return null; }
    }
    function systemTheme() {
        return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', storedTheme() || systemTheme());

    const icons = {
        sun: '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        moon: '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
        menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
        github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.3 4.3 18.3 4.6 18.3 4.6c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"/></svg>',
        linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6h.1c.5-.9 1.6-1.8 3.4-1.8 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM7.1 20.5H3.5V9h3.6v11.5zM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0z"/></svg>',
        mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
    };
    window.siteIcons = icons;

    const links = [
        ['index.html', 'Home'],
        ['about.html', 'About'],
        ['projects.html', 'Projects'],
        ['resume.html', 'Resume'],
        ['contact.html', 'Contact'],
    ];

    function currentPage() {
        const file = location.pathname.split('/').pop();
        return file === '' ? 'index.html' : file;
    }

    function renderHeader(el) {
        const here = currentPage();
        el.className = 'site-header';
        el.innerHTML =
            '<div class="container">' +
                '<a href="index.html" class="wordmark">Yousuf Kazmi<span>.</span></a>' +
                '<nav class="nav" id="site-nav" aria-label="Main">' +
                    links.map(([href, label]) =>
                        `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`).join('') +
                '</nav>' +
                '<div class="header-actions">' +
                    `<button class="icon-btn theme-toggle" type="button" aria-label="Toggle dark mode">${icons.moon}${icons.sun}</button>` +
                    `<button class="icon-btn menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">${icons.menu}</button>` +
                '</div>' +
            '</div>';

        el.querySelector('.theme-toggle').addEventListener('click', () => {
            const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
        });

        const nav = el.querySelector('.nav');
        const menuBtn = el.querySelector('.menu-toggle');
        menuBtn.addEventListener('click', () => {
            const open = nav.classList.toggle('open');
            menuBtn.setAttribute('aria-expanded', open);
        });
    }

    function renderFooter(el) {
        el.className = 'site-footer';
        el.innerHTML =
            '<div class="container">' +
                `<small>&copy; ${new Date().getFullYear()} Yousuf Kazmi</small>` +
                '<div class="socials">' +
                    `<a href="https://github.com/yousuf3131" target="_blank" rel="noopener" aria-label="GitHub">${icons.github}</a>` +
                    `<a href="https://www.linkedin.com/in/yousufkazmi/" target="_blank" rel="noopener" aria-label="LinkedIn">${icons.linkedin}</a>` +
                    `<a href="mailto:yousufkazmi3131@gmail.com" aria-label="Email">${icons.mail}</a>` +
                '</div>' +
            '</div>';
    }

    document.addEventListener('DOMContentLoaded', () => {
        const header = document.getElementById('site-header');
        const footer = document.getElementById('site-footer');
        if (header) renderHeader(header);
        if (footer) renderFooter(footer);
        // Fill any inline icon placeholders: <span data-icon="github"></span>
        document.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = icons[n.dataset.icon] || ''; });
    });
})();

// // When the page loads, zoom in
// window.addEventListener('load', () => {
//     document.body.classList.add('zoom-in');
// });

// // When clicking on a link, zoom out before navigating
// document.querySelectorAll('a').forEach(anchor => {
//     anchor.addEventListener('click', function (e) {
//         e.preventDefault();
//         const target = this.href;
//         document.body.classList.remove('zoom-in');
//         document.body.classList.add('zoom-out');
//         setTimeout(() => {
//             window.location.href = target;
//         }, 500); // Time for the zoom-out effect to complete
//     });
// });

document.addEventListener('DOMContentLoaded', () => {
    document.body.style.opacity = '0';
    
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease-in';
        document.body.style.opacity = '1';
    }, 100);
    
    document.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            if (link.hostname === window.location.hostname) {
                e.preventDefault();
                document.body.style.opacity = '0';
                
                setTimeout(() => {
                    window.location = link.href;
                }, 500);
            }
        });
    });
});

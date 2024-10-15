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

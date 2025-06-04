// Get the elements needed
const toggleIcon = document.getElementById("toggle-dark-mode");
const body = document.body;
const homeImage = document.getElementById("home-image");

// Function to toggle dark mode
toggleIcon.addEventListener('click', function() {
    body.classList.toggle("dark-mode");

    // Check if dark mode is enabled
    if (body.classList.contains("dark-mode")) {
        toggleIcon.src = "assets/sun.png"; // Switch to sun icon
        homeImage.src = "assets/blackbkgDeskMan.jpg"; // Switch to dark mode image
    } else {
        toggleIcon.src = "assets/moon.png"; // Switch to moon icon
        homeImage.src = "assets/DeskMan.jpg"; // Switch back to light mode image
    }
});

function toggleDarkMode() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update toggle button icon
    const toggleIcon = document.getElementById('theme-toggle-icon');
    toggleIcon.src = newTheme === 'dark' ? 'assets/sun.png' : 'assets/moon.png';
}

// Set initial theme based on user preference
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
});



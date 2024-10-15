function toggleInfo() {
    const moreInfoSection = document.getElementById("more-info");
    const arrowText = document.getElementById("arrow-text");
    const arrowIcon = document.getElementById("arrow-icon");

    // Toggle the display of the more info section
    if (moreInfoSection.style.display === "block") {
        moreInfoSection.style.display = "none";
        arrowText.innerText = "More about me";
        arrowIcon.innerHTML = "&#x25BC;"; // Down arrow (▼)
    } else {
        moreInfoSection.style.display = "block";
        arrowText.innerText = "Less about me";
        arrowIcon.innerHTML = "&#x25B2;"; // Up arrow (▲)
    }
}


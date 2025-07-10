function toggleInfo() {
    const moreInfo = document.getElementById('more-info');
    const arrow = document.getElementById('arrow-icon');
    const arrowText = document.getElementById('arrow-text');
    
    moreInfo.classList.toggle('hidden-section');
    
    if (moreInfo.classList.contains('hidden-section')) {
        arrow.innerHTML = '&#x25BC;';
        arrowText.textContent = 'More about me';
    } else {
        arrow.innerHTML = '&#x25B2;';
        arrowText.textContent = 'Show less';
    }
}


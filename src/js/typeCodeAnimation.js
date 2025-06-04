const codeSnippet = `function createPortfolio() {
    const skills = ['JavaScript', 'React', '.NET', 'AWS'];
    const passion = 'Building awesome web apps';
    
    return {
        developer: 'Yousuf Kazmi',
        goal: 'Creating innovative solutions',
        connect: 'https://yoahka.com'
    };
}`;

function typeCode() {
    const codeDisplay = document.getElementById('code-display');
    let i = 0;
    
    function type() {
        if (i < codeSnippet.length) {
            codeDisplay.textContent += codeSnippet.charAt(i);
            i++;
            setTimeout(type, 50);
        }
    }
    
    type();
}

document.addEventListener('DOMContentLoaded', typeCode);

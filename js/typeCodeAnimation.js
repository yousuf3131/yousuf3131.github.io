const codeSnippets = [
    {
        language: 'Python',
        snippet: `print("Hello Hello Hello")`
    },
    {
        language: 'C#',
        snippet: `Console.WriteLine("My name is Yousuf Kazmi");`
    },
    {
        language: 'HTML',
        snippet: `&lt;h1&gt;What is my name&lt;/h1&gt;`
    }
];

let currentSnippet = 0;
let currentChar = 0;
let isErasing = false;
const typingSpeed = 150;
const erasingSpeed = 100;
const pauseBetween = 1000;
const codeDisplay = document.getElementById('code-display');

function typeCode() {
    const current = codeSnippets[currentSnippet];

    if (!isErasing) {
        codeDisplay.innerHTML = current.snippet.slice(0, currentChar + 1);
        currentChar++;

        if (currentChar === current.snippet.length) {
            isErasing = true;
            setTimeout(typeCode, pauseBetween);
        } else {
            setTimeout(typeCode, typingSpeed);
        }
    } else {
        codeDisplay.innerHTML = current.snippet.slice(0, currentChar - 1);
        currentChar--;

        if (currentChar === 0) {
            isErasing = false;
            currentSnippet = (currentSnippet + 1) % codeSnippets.length;
            setTimeout(typeCode, pauseBetween);
        } else {
            setTimeout(typeCode, erasingSpeed);
        }
    }
}

// Start typing the code when the page loads
window.onload = function() {
    setTimeout(typeCode, typingSpeed);
};

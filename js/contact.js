document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('#contact-form form');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(form);
        const email = formData.get('email');
        const message = formData.get('message');
        
        if (!validateEmail(email)) {
            alert('Please enter a valid email address');
            return;
        }
        
        try {
            await form.submit();
            form.reset();
            alert('Message sent successfully!');
        } catch (error) {
            alert('Error sending message. Please try again.');
        }
    });
    
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
});

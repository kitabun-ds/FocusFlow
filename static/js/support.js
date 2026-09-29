(() => {
    const form = document.querySelector(".support-form");
    if (!form) return;

    const message = form.querySelector("textarea[name='message']");
    const button = form.querySelector("button[type='submit']");
    const label = form.querySelector(".support-send-label");

    message.addEventListener("input", () => message.setCustomValidity(""));
    form.addEventListener("submit", (event) => {
        if (!message.value.trim()) {
            event.preventDefault();
            message.setCustomValidity("Please enter a message before sending.");
            message.reportValidity();
            return;
        }

        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        label.textContent = "Sending...";
    });
})();
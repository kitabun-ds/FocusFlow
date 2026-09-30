(function () {
    "use strict";

    const root = document.getElementById("notificationSettings");
    if (!root) return;

    const csrfToken = root.dataset.csrfToken || "";
    const status = document.getElementById("notificationPermissionState");
    const enabledInput = document.getElementById("notificationsEnabled");
    const toggleState = document.getElementById("notificationsToggleState");
    const saveButton = document.getElementById("saveNotificationPreferences");
    const categoryInputs = Array.from(document.querySelectorAll("[data-notification-category]"));
    const saveButtonText = saveButton?.textContent || "Save Changes";
    let config = null;
    let settingsLoaded = false;
    let saveConfirmationTimer = null;

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function renderToggleState() {
        if (!enabledInput || !toggleState) return;
        const enabled = enabledInput.checked;
        toggleState.textContent = enabled ? "On" : "Off";
        toggleState.classList.toggle("is-on", enabled);
    }

    function selectedCategories() {
        return Object.fromEntries(categoryInputs.map(input => [
            input.dataset.notificationCategory,
            input.checked
        ]));
    }

    function renderPermissionState() {
        if (!config) return;

        const accountState = config.enabled
            ? "Account notification preference is On."
            : "Account notification preference is Off.";
        const messages = [accountState];

        if (!config.publicKey) {
            messages.push("Push delivery is not configured on the Flask server yet.");
        }
        if (!window.isSecureContext) {
            messages.push("This page needs a secure HTTPS connection for push.");
        } else if (!(("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window))) {
            messages.push("This browser does not support Web Push.");
        } else if (Notification.permission === "denied") {
            messages.push("Browser permission is blocked on this device, so it cannot display push notifications.");
        } else if (Notification.permission === "default") {
            messages.push("Browser permission has not been granted on this device.");
        } else {
            messages.push("Browser permission is granted on this device.");
        }

        setStatus(messages.join(" "));
    }

    async function postJSON(url, body) {
        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            body: JSON.stringify(body)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not save notification settings.");
        return result;
    }

    function applicationServerKey(value) {
        const padded = value + "=".repeat((4 - value.length % 4) % 4);
        const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    }

    async function ensureSubscription() {
        if (!config?.publicKey) throw new Error("Push delivery is not configured on the Flask server yet.");
        const registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey(config.publicKey)
            });
        }
        const serialized = typeof subscription.toJSON === "function"
            ? subscription.toJSON()
            : JSON.parse(JSON.stringify(subscription));
        await postJSON("/api/notifications/subscriptions", { subscription: serialized });
    }

    async function preparePushOnThisDevice() {
        if (!window.isSecureContext || !("Notification" in window)
            || !("serviceWorker" in navigator) || !("PushManager" in window)) {
            throw new Error("This browser or connection cannot enable Web Push.");
        }
        if (!config?.publicKey) {
            throw new Error("Push delivery is not configured on the Flask server yet. The account preference was not changed.");
        }

        let permission = Notification.permission;
        if (permission === "default") permission = await Notification.requestPermission();
        if (permission !== "granted") {
            throw new Error(permission === "denied"
                ? "Browser permission is blocked on this device. The account preference was not changed."
                : "Browser permission was not granted. The account preference was not changed.");
        }
        await ensureSubscription();
    }

    async function savePreferences({ preparePush = false } = {}) {
        const enabled = Boolean(enabledInput?.checked);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

        if (enabled && preparePush) await preparePushOnThisDevice();

        const result = await postJSON("/api/notifications/preferences", {
            enabled,
            timezone,
            categories: selectedCategories()
        });
        config = { ...config, ...result, timezone };
        renderToggleState();
        renderPermissionState();
        return result;
    }

    function setSaving(saving) {
        if (enabledInput) enabledInput.disabled = saving || !settingsLoaded;
        if (saveButton) saveButton.disabled = saving || !settingsLoaded;
    }

    function clearSavedConfirmation() {
        if (saveConfirmationTimer !== null) window.clearTimeout(saveConfirmationTimer);
        saveConfirmationTimer = null;
        if (saveButton) {
            saveButton.textContent = saveButtonText;
            saveButton.classList.remove("is-saved");
        }
    }

    function showSavedConfirmation() {
        if (!saveButton) return;
        clearSavedConfirmation();
        saveButton.textContent = "Saved";
        saveButton.classList.add("is-saved");
        saveConfirmationTimer = window.setTimeout(clearSavedConfirmation, 2200);
    }

    async function loadSettings() {
        try {
            const response = await fetch("/api/notifications/config", { credentials: "same-origin" });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Could not load notification settings.");
            config = result;
            if (enabledInput) enabledInput.checked = Boolean(config.enabled);
            categoryInputs.forEach(input => {
                const category = input.dataset.notificationCategory;
                input.checked = config.categories?.[category] !== false;
            });
            settingsLoaded = true;
            setSaving(false);
            renderToggleState();
            renderPermissionState();
        } catch (error) {
            setStatus(error.message || "Could not load notification settings.");
            setSaving(false);
            if (enabledInput) enabledInput.disabled = true;
            if (saveButton) saveButton.disabled = true;
        }
    }

    if (enabledInput) {
        enabledInput.addEventListener("change", async () => {
            const previousEnabled = Boolean(config?.enabled);
            const requestedEnabled = enabledInput.checked;
            setSaving(true);
            try {
                await savePreferences({ preparePush: requestedEnabled && !previousEnabled });
            } catch (error) {
                enabledInput.checked = previousEnabled;
                renderToggleState();
                renderPermissionState();
                setStatus(error.message || "Could not save notification preference.");
            } finally {
                setSaving(false);
            }
        });
    }

    if (saveButton) {
        saveButton.addEventListener("click", async () => {
            clearSavedConfirmation();
            const previousEnabled = Boolean(config?.enabled);
            const requestedEnabled = Boolean(enabledInput?.checked);
            setSaving(true);
            try {
                await savePreferences({ preparePush: requestedEnabled && !previousEnabled });
                showSavedConfirmation();
            } catch (error) {
                if (enabledInput) enabledInput.checked = previousEnabled;
                renderToggleState();
                renderPermissionState();
                setStatus(error.message || "Could not save notification settings.");
            } finally {
                setSaving(false);
            }
        });
    }

    loadSettings();
})();

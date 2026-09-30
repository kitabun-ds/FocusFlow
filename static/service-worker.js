"use strict";

self.addEventListener("push", event => {
    let message = {};
    try {
        message = event.data ? event.data.json() : {};
    } catch (_) {
        message = { body: event.data ? event.data.text() : "FocusFlow has an update for you." };
    }

    const title = String(message.title || "FocusFlow");
    const options = {
        body: String(message.body || "Open FocusFlow to continue with your goals."),
        icon: message.icon || "/static/images/sunocean.jpeg",
        badge: message.badge || "/static/images/sunocean.jpeg",
        tag: String(message.tag || message.eventKey || "focusflow-notification"),
        renotify: false,
        data: { path: message.path || "/goals" }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const requestedPath = event.notification.data?.path || "/goals";
    const target = new URL(requestedPath, self.location.origin);
    if (target.origin !== self.location.origin) target.href = new URL("/goals", self.location.origin).href;

    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if ("focus" in client) {
                if ("navigate" in client) await client.navigate(target.href);
                return client.focus();
            }
        }
        return self.clients.openWindow(target.href);
    })());
});

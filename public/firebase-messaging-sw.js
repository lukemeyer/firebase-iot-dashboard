// Import and configure the Firebase SDK
// These scripts are made available when the app is served or deployed on Firebase Hosting
// If you do not serve/host your project using Firebase Hosting see https://firebase.google.com/docs/web/setup
importScripts('/__/firebase/5.0.3/firebase-app.js');
importScripts('/__/firebase/5.0.3/firebase-messaging.js');
importScripts('/__/firebase/init.js');

firebase.messaging();

self.addEventListener('notificationclick', function (event) {
    var tag = event.notification.data.FCM_MSG.data.tag;

    event.notification.close();

    if (event.action === 'view' && tag !== undefined) {
        clients.openWindow("/?/status#" + tag);
    }
    else {
        clients.openWindow("/?/status");
    }
}, false);
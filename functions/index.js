let functions = require('firebase-functions');
const admin = require('firebase-admin');
const shortid = require('shortid');
const chrono = require('chrono-node');

admin.initializeApp(functions.config().firebase);

exports.ingest = functions.https.onRequest((req, res) => {
    var type = req.headers['content-type'];
    if (!type || type.indexOf('application/json') !== 0) {
        return res.send(400);
    }

    admin.database().ref(buildEventPathFromEvent(req.body)).push(req.body).catch(error => {
        console.log(error);
        res.send(400);
    }).then(snapshot => {
        admin.database().ref(buildStatusPathFromEvent(req.body)).set(req.body).catch(error => {
            console.log(error);
            res.send(400);
        }).then(snapshot => {
            res.send(200);
        });
    });

});

exports.webhook = functions.https.onRequest((req, res) => {
    //check for json payload
    let type = req.headers['content-type'];
    if (!type || type.indexOf('application/json') !== 0) {
        return res.send(400);
    }

    let payload = req.body;

    //check for webhookKey property
    if (!payload.hasOwnProperty('webhookKey')) {
        return res.send(400);
    }

    //check for users with the webhook key
    //TODO: support many to many webhookKeys <=> users
    admin.database().ref('/users/').orderByChild("webhookKey").equalTo(payload.webhookKey).once('value', function (snapshot) {
        let users = snapshot.val();

        if (users != null) {
            for (let userKey in users) {
                if (users.hasOwnProperty(userKey)) {
                    let user = users[userKey];

                    // format payload
                    if (PayloadFormatter.hasOwnProperty(payload.type)) {
                        payload = PayloadFormatter[payload.type](payload, user);
                    } else {
                        payload = PayloadFormatter.default(payload, user);
                    }

                    let deviceKey = payload.device + '-' + payload.type;

                    //write to keys's history
                    admin.database().ref('/history/' + payload.webhookKey + '/' + deviceKey).push(payload).catch(error => {
                        console.log(error);
                        res.send(400);
                    }).then(snapshot => {
                        res.send(200);
                    });

                    //send notifications
                    //check if user has requested notifications for this device
                    if ( user.hasOwnProperty('notificationPreferences') && user.notificationPreferences.hasOwnProperty(deviceKey) ) {
                        let preference = user.notificationPreferences[deviceKey];

                        console.log('sending notifications ' + preference + ' for ' + deviceKey);

                        // Notification details.
                        let notif = NotificationTemplate;
                        if (NotificationFormatter.hasOwnProperty(payload.type)) {
                            notif = NotificationFormatter[payload.type](payload, user);
                        } else {
                            notif = NotificationFormatter.default(payload, user);
                        }

                        // Listing all tokens.
                        const tokens = Object.keys(user.notificationTokens);
                        //console.log('There are', tokens.length, 'tokens to send notifications to.');
                        // Send notifications to all tokens.
                        admin.messaging().sendToDevice(tokens, notif).then(response => {
                            // For each message check if there was an error.
                            const tokensToRemove = [];
                            response.results.forEach((result, index) => {
                                const error = result.error;
                                if (error) {
                                    console.error('Failure sending notification to', tokens[index], error);
                                    // Cleanup the tokens who are not registered anymore.
                                    if (error.code === 'messaging/invalid-registration-token' ||
                                        error.code === 'messaging/registration-token-not-registered') {
                                        tokensToRemove.push(admin.database().ref('/users/' + userKey + '/notificationTokens/' + tokens[index]).remove());
                                    }
                                }
                            });
                            return Promise.all(tokensToRemove);
                        });

                        if ( preference === 'once' ){
                            return admin.database().ref('/users/' + userKey + '/notificationPreferences/' + deviceKey).remove();
                        }
                    } else {
                        console.log('No notifications requested for ' + deviceKey);
                    }
                }
            }
        } else {
            return res.send(400);
        }
    });

});

exports.updateLatestFromHistory = functions.database.ref('/history/{webhookKey}/{deviceKey}/{pushID}')
    .onCreate(function (event) {
        //Write event into user's status
        return admin.database().ref('/status/' + event.params.webhookKey + '/' + event.params.deviceKey).set(event.data.val());
    });

exports.generateWebhookKey = functions.database.ref('/users/{uid}')
    .onCreate(function (event) {
        //Write a shortid into the webhookKey propery of new users
        return event.data.ref.child('webhookKey').set(shortid.generate());
    });

function buildEventPathFromEvent(event) {
    let segments = ['/events', event.location_id, event.name];
    return segments.join('/');
}

function buildStatusPathFromEvent(event) {
    let segments = ['/status', event.location_id, (event.id + '-' + event.name)];
    return segments.join('/');
}

function normalizeDate(dateString, timezone) {
    // Parse the date string
    let newDate = chrono.parse(dateString);

    if (!newDate[0].start.isCertain('timezoneOffset')) {
        // Build a date string with the timezone name
        const refString = new Date().toLocaleString("en-US", { timeZone: timezone, timeZoneName: "short" });
        const referenceDate = chrono.parse(refString);

        // Assign the timezone offset from the reference
        newDate[0].start.assign('timezoneOffset', referenceDate[0].start.get('timezoneOffset'));
    }

    return newDate !== null ? newDate[0].start.date().toJSON() : dateString;
}

const PayloadFormatter = {
    default: function (payload, user) {
        //Standardize date format
        payload.date = normalizeDate(payload.date, user.timezone);

        return payload;
    }
}

PayloadFormatter.trip = function (payload, user) {

    // Run default formatter
    payload = PayloadFormatter.default;



    return payload;
}
const NotificationTemplate = {
    notification: {
        title: '',
        body: '',
        icon: ''
    }
}
const NotificationFormatter = {
    default: function (payload, user) {
        let notif = NotificationTemplate;
        notif.notification.title = payload.displayName;
        notif.notification.body = payload.description;

        return notif;
    }
}

/*
let user = {
    displayName: "",
    uid: "",
    webhookKey: "",
    timezone: 'America/Indianapolis',
    notificationTokens: {
        {token}: 'true'
    },
    notificationPreferences: {
        "{deviceKey}": "once|every"
    }
}

let event = {
    webhookKey: "",
    device: "",
    type: "",
    value: "",
    date: "",
    displayName: "",
    description: "",
    extra: {
        "key" : "value",
        "key" : "value"
        ...
    }
}
*/
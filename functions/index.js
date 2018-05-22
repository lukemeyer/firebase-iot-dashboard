const functions = require('firebase-functions');
const admin = require('firebase-admin');

const express = require("express")

const shortid = require('shortid');
const chrono = require('chrono-node');

admin.initializeApp();

/**
 * Firestore Triggers
 */
// Handle user creation
exports.userCreated = functions.firestore
    .document('Users/{userId}')
    .onCreate((userDocument, context) => {
        // Create a batch for all the writes
        let createUserBatch = admin.firestore().batch();

        // Get data off the event
        const data = userDocument.data();
        const userId = context.params.userId;

        // Define a new user
        const userTemplate = {
            displayName: "",            // Name to show in UI
            uid: userId,                // Firebase generated user id
            channels: {},                 // Channels known to this user
            timezone: '',               // Timezone to use when it is uncertain
            notificationTokens: [],     // Registered push notification tokens
            notificationPreferences: {} // Which devices trigger a notification
        };

        let user = Object.assign({},userTemplate,data);

        // Set up a channel for this user
        const firstChannelID = shortid.generate();
        user.channels[firstChannelID] = {
            visible: true
        };

        // Write the user
        createUserBatch.set(userDocument.ref, user);

        // Define a the channel in channels document
        let channelDoc = {
            name: user.displayName + "'s Channel", // Group name to show in UI
            description: "Automatically created channel.",
            viewers: {}, // Map of users that can view this channel
            latest: {} // Map containing the last event from each source
        };
        channelDoc.viewers[userId] = true;

        // Write the channel
        createUserBatch.set(admin.firestore().doc('Channels/' + firstChannelID), channelDoc);

        // Define a new key for the user/channel
        const firstChannelKey = shortid.generate();

        let keyDoc = {
            owner: userId, // User id of the owner of this key
            channel: firstChannelID, // The channel this key applies to
            permissions: {
                writeEvents: true, // Can this key be used to write events to the channel
            },
            isEnabled: true // Is this key active
        };

        // Write the key document
        createUserBatch.set(admin.firestore().doc('AccessKeys/' + firstChannelKey), keyDoc);

        // Do the batch write
        return createUserBatch.commit();
});

// Handle AccessKey,Channel create requests
exports.requestHandler = functions.firestore
.document('Requests/{userId}/Requests/{requestId}')
.onCreate((docSnapshot, context) => {
    const userId = context.params.userId;
    const request = docSnapshot.data();

    // Do the reqested action
    switch (request.type) {
        case 'Channel':
            return createChannel(userId);
        break;
        case 'AccessKey':
            return createAccessKey(request.channelId, userId);    
        break;
    }

    //TODO: Delete request if successful
});

/**
 * HTTP Triggers
 */

 // Use express for routing
exports.echo = functions.https.onRequest(
    express().get("/echo/:first?/:second?/:third?", (req, res) => {
        //set no cache
        res.set('Cache-Control', 'no-cache, max-age=0, s-maxage=0');
    
        let echo = {
            function: "echo",
            method: req.method,
            headers: req.headers,
            url: req.url,
            params: req.params,
            body: req.body,
            hasThird: req.params.third !== undefined
        }
    
        res.status(200).send(JSON.stringify(echo));
    })
);

exports.api = functions.https.onRequest(
    express().all("/api/:apiKey?/webhook", (req, res) => {
    //set no cache
    res.set('Cache-Control', 'no-cache, max-age=0, s-maxage=0');

    //check for json payload
    let type = req.headers['content-type'];
    if (!type || type.indexOf('application/json') !== 0) {
        return res.status(400).send("Invalid content-type");
    }

    let payload = req.body;

    // Get the apiKey from params or payload
    let activeKey;
    try {
        activeKey = req.params.apiKey || payload.apiKey;
        if ( activeKey === undefined ){
            throw "Key not found";
        }
    } catch (err) {
        console.error('Missing apiKey.');
        return res.status(400).send("Missing API key");
    }

    // Check event key
    admin.firestore().collection('AccessKeys').doc(activeKey)
    .get()
    .then(keyDocSnapshot => {
        if (!keyDocSnapshot.exists) {
            console.log('Key not found: ' + activeKey);
            res.status(400).send("API key not found.");
        } else {
            // Key found
            const key = keyDocSnapshot.data();
            if ( key.isEnabled === true && key.permissions.writeEvents === true ){
                // Get the owner of the key
                admin.firestore().collection('Users').doc(key.owner)
                .get()
                .then( userDocumentSnapshot => {
                    const user = userDocumentSnapshot.data();
                    // Format the payload for saving
                    // format payload: look for custom formatter or use default
                    if (PayloadFormatter.hasOwnProperty(payload.type)) {
                        payload = PayloadFormatter[payload.type](payload, user);
                    } else {
                        payload = PayloadFormatter.default(payload, user);
                    }

                    const topicKey = payload.topic;
                    
                    // Write to channel's event collection
                    admin.firestore().collection('Channels').doc(key.channel).collection('Events')
                    .add(payload)
                    .then( documentReference => {
                        // Write to channel's latest events
                        let latestUpdate =  {};
                        latestUpdate["latest." +topicKey] = payload;

                        admin.firestore().collection('Channels').doc(key.channel)
                        .update(latestUpdate)
                        .then( writeResult => {
                            res.send(200);
                        })
                        .catch(error => {
                            console.log("Write latest failed.",error);
                            res.send(400);
                        });
                    })
                    .catch(error => {
                        console.log("Write event failed.",error);
                        res.send(400);
                    });

                    sendNotifications(payload, key.channel, topicKey);
                })
                .catch(error => {
                    console.log("User not found",error);
                    res.send(400);
                });
            } else {
                console.log('API key is not authorized', err);
                res.status(400).send("API key is not authorized");
            }
        }
    })
    .catch(err => {
        console.log('Error getting document', err);
        res.send(400);
    });
})
);

function sendNotifications (event, channelId, topic) {
    // Get all users that subscribe to this channel+topic
    admin.firestore().collection('Users').where('notificationPreferences.' + (channelId + '-' + topic) + '.enabled', '==', true)
    .get()
    .then( querySnapshot => {
        querySnapshot.docs.forEach(function(userDocSnapshot){
            const user = userDocSnapshot.data();
            const frequency = user.notificationPreferences[channelId + '-' + topic].frequency;
            
            // Build notification content
            console.log('Notifying ' + user.displayName + ' ' + frequency + ' for ' + channelId + '-' + topic);

            // Notification details.
            let notif = NotificationTemplate;
            if (NotificationFormatter.hasOwnProperty(event.topicType)) {
                notif = NotificationFormatter[event.topicType](event, user);
            } else {
                notif = NotificationFormatter.default(event, user);
            }

            // Get all tokens to send to
            // Listing all tokens.
            const tokens = Object.keys(user.notificationTokens);
            console.log('There are', tokens.length, 'tokens to send notifications to.');

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const notifSingle = Object.assign({}, notif);
                notifSingle.token = token;

                admin.messaging().send(notifSingle).then(response => {
                    //console.log('Sent notification to', token);
                }).catch(error => {
                    console.error('Failure sending notification to', token, error);
                        // Cleanup the tokens who are not registered anymore.
                        if (error.code === 'messaging/invalid-registration-token' ||
                            error.code === 'messaging/registration-token-not-registered') {
                            return userDocSnapshot.ref.update('notificationTokens.' + token, admin.firestore.FieldValue.delete());
                        }
                });
            }

/*             // Send notifications to all tokens.
            admin.messaging().sendToDevice(tokens, notif).then(response => {
                // For each message, check if there was an error.
                const tokensToRemove = [];
                response.results.forEach((result, index) => {
                    const error = result.error;
                    if (error) {
                        console.error('Failure sending notification to', tokens[index], error);
                        // Cleanup the tokens who are not registered anymore.
                        if (error.code === 'messaging/invalid-registration-token' ||
                            error.code === 'messaging/registration-token-not-registered') {
                            tokensToRemove.push(userDocSnapshot.ref.update('notificationTokens.' + tokens[index], admin.firestore.FieldValue.delete()));
                        }
                    }
                });
                if ( tokensToRemove.length > 0 ){
                    console.log('Removing ' + tokensToRemove.length + ' tokens.');
                }
                return Promise.all(tokensToRemove);
            }); */

            if ( frequency === 'once' ){
                return userDocSnapshot.ref.update('notificationPreferences.' + (channelId + '-' + topic), admin.firestore.FieldValue.delete())
            }
        });
    })
}

/* exports.ingest = functions.https.onRequest((req, res) => {
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

}); */

/* exports.webhook = functions.https.onRequest((req, res) => {
    //set no cache
    res.set('Cache-Control', 'no-cache, max-age=0, s-maxage=0');
    
    //check for json payload
    let type = req.headers['content-type'];
    if (!type || type.indexOf('application/json') !== 0) {
        return res.send(400);
    }

    let payload = req.body;

    //check for webhookKey property
    if (!payload.hasOwnProperty('webhookKey')) {
        console.error('Missing webhookKey in payload.');
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

                    // format payload: look for custom formatter or use default
                    if (PayloadFormatter.hasOwnProperty(payload.type)) {
                        payload = PayloadFormatter[payload.type](payload, user);
                    } else {
                        payload = PayloadFormatter.default(payload, user);
                    }

                    let deviceKey = payload.source + '-' + payload.type;

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
                            if ( tokensToRemove.length > 0 ){
                                console.log('Removing ' + tokensToRemove.length + ' tokens.');
                            }
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

}); */

/* exports.updateLatestFromHistory = functions.database.ref('/history/{webhookKey}/{deviceKey}/{pushID}')
    .onCreate(function (event) {
        //Write event into user's status
        return admin.database().ref('/status/' + event.params.webhookKey + '/' + event.params.deviceKey).set(event.data.val());
    }); */

/* exports.generateWebhookKey = functions.database.ref('/users/{uid}')
    .onCreate(function (event) {
        //Write a shortid into the webhookKey propery of new users
        return event.data.ref.child('webhookKey').set(shortid.generate());
    }); */

function createAccessKey (channel, ownerId){
    // Define a new key for the user/channel
    const newKey = shortid.generate();
    
    let keyDoc = {
        'owner': ownerId, // User id of the owner of this key
        'channel': channel, // The channel this key applies to
        'permissions': {
            'writeEvents': true, // Can this key be used to write events to the channel
        },
        'isEnabled': true // Is this key active
    };

    // Write the key document
    return admin.firestore().doc('AccessKeys/' + newKey).set(keyDoc);
}

function createChannel (ownerId, name, description) {
    // Define a the channel in channels document
    let channelDoc = {
        name: name || "New Channel", // Group name to show in UI
        description: description || "Channel Description",
        viewers: {}, // Map of users that can view this channel
        latest: {} // Map containing the last event from each source
    };
    channelDoc.viewers[ownerId] = true;

    // Write the channel and create an access key
    return admin.firestore().collection('Channels').add(channelDoc)
    .then(function(docRef) {
        console.log("Channel created ", docRef.id);
        return createAccessKey(docRef.id,ownerId);
    })
    .catch(function(error) {
        console.error("Error creating channel: ", error);
    });
}

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

    return newDate !== null ? newDate[0].start.date() : dateString;
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
    payload = PayloadFormatter.default(payload, user);

    return payload;
}
const NotificationTemplate = {
    notification: {
        title: '',
        body: ''
    },
    webpush: {
        notification: {}, 
    }
}
const NotificationFormatter = {
    default: function (event, user) {
        let notif = NotificationTemplate;
        // Base
        notif.notification.title = event.subject;
        notif.notification.body = event.message;

        // Web Push
        notif.webpush.notification.click_action = functions.config().hosting.url;
        notif.webpush.notification.icon = functions.config().hosting.url + '/img/icon.png';

        if ( event.valueType === 'image_url' ){
            notif.webpush.notification.image = event.value;
        }
        return notif;
    }
}

/*
let user = {
    displayName: "", // Name to show in UI
    uid: "", // Firebase generated user id
    groups: [], // Which event groups are owned/visible
    timezone: 'America/Indianapolis', // Timezone to use when it is uncertain
    notificationTokens: { // Registered push notification tokens
        {token}: 'true'
    },
    notificationPreferences: { // Which devices trigger a notification
        "{deviceKey}": "once|every"
    }
}

let event = {
    apiKey: "",
    date: "",
    topic: "",
    topicType: "",
    subject: "",
    message: "",
    value: "",
    valueType: "",
    meta: {
        "key" : "value",
        "key" : "value"
        ...
    }
}
*/
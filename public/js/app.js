//@ts-check
'use strict';

const thresholds = {
    maxAcceptableDelay: 30 * 1000, // Delay in ms after which it is shown to user
    maxClusterDistance: 5 * 60 * 1000 // Max distance in ms to consider events as part of the same group
}

const nameIcons = {
    'contact': '🚪',
    'motion': '👁️',
    'presence': '👤',
    'switch': '🎚️',
    'temperature': '🌡️',
    'lock': '🔑'
}

const mdIcons = {
    'contact': 'flip',
    'motion': 'visibility',
    'presence': 'account_box',
    'switch': 'offline_bolt',
    'temperature': 'ac_unit',
    'lock': 'lock',
    'smartthings-contact': 'flip',
    'smartthings-motion': 'visibility',
    'smartthings-presence': 'account_box',
    'smartthings-switch': 'offline_bolt',
    'smartthings-temperature': 'ac_unit',
    'smartthings-lock': 'lock',
    'smartthings-illuminance': 'wb_sunny',
    'battery_status': 'battery_std',
    'smartthings-humidity': 'opacity',
    'smartthings-button': 'radio_button_checked',
    'smartthings-energy': 'power',
    'smartthings-water': 'waves',
    'wunderground_weather': 'filter_drama'
}

// Model
let Datastore = {
    db: null,
    RuntimePrefs: {},
    init: function(user){
        Datastore.db = firebase.firestore();
        // Get user record, send to status or user config
        Datastore.db.collection('Users').doc(user.uid).get()
        .then(function(doc){
            if ( doc.exists ){
                // Found user
                console.log("User successfully loaded.");
                Datastore.User = doc.data();
            } else {
                // First login, store user to DB
                Datastore.User = {'displayName': user.displayName, 'uid': user.uid};

                doc.set(Datastore.User)
                .then(function() {
                    console.log("User successfully saved.");
                    m.route.set('/profile');
                })
                .catch(function(error) {
                    console.error("Error creating user in firestore: ", error);
                });
            }
            // Refresh notification token
            Datastore.UserFunctions.registerNotifications();

            // Set up connections
            Datastore.UserFunctions.subscribe();
            Datastore.AccessKeyFunctions.subscribe();
            Datastore.ChannelFunctions.subscribe().then(function(channels){
                
                // Check for a specific topic link, otherwise show timeline
                if ( Datastore.RuntimePrefs.statusFocus ) {

                    let route = '/status/' + Datastore.RuntimePrefs.statusFocus;
                    m.route.set(route);
                    Datastore.TimelineFunctions.get(Object.keys(Datastore.Channels)).then(function(){
                        Datastore.Status.subscribed = true;
                    });
                } else {
                    Datastore.TimelineFunctions.get(Object.keys(Datastore.Channels)).then(function(){
                        Datastore.Status.subscribed = true;
                        m.route.set('/timeline');
                    });
                }
                
            }).catch(function(e){
                console.error(e)
            });
        })
        .catch(function(error){
            console.error("Error retrieving user: ", error);
        });
    },
    Status: {
        Connected: false,
        subscribed: false
    },
    User: {},
    UserFunctions: {
        subscribe: function(){
            if ( Datastore.User.uid !== undefined ){
                // Get user's AccessKeys
                Datastore.UserFunctions.unsubscribe = Datastore.db.collection('Users').doc(Datastore.User.uid)
                .onSnapshot(function(snapshot){
                    let user = snapshot.data();
                    console.log('User updated ' + user.displayName);
                    if ( snapshot.exists ){
                        Datastore.User = user;
                    } else {
                        console.log('User deleted????');
                    }
                    // Redraw after commiting changes
                    m.redraw();
                });
            }
        },
        unsubscribe: null,
        setTimezone: function (value) {
            // Validate
            try {
                new Date().toLocaleString("en-US", { timeZone: value, timeZoneName: "long" });
                Datastore.User.timezone = value;
                // Store to db
                firebase.firestore().collection('Users').doc(Datastore.User.uid).set({timezone: value}, {merge:true})
                .then(function(){ console.log('Timezone saved as: ' + value); })
                .catch(function(err){ console.error('Error saving timezone:',err)});
            } catch (e) {
                console.log(e);
            }

        },
        setNotificationPreference: function (channelId, topicId, frequency) {
            let notificationUpdate = {};
            let notificationProps = {};
            if ( frequency === 'never' ){
                notificationProps = firebase.firestore.FieldValue.delete();
            } else {
                notificationProps = {
                    'frequency': frequency,
                    'enabled' : true
                }
            }
            
            notificationUpdate['notificationPreferences.' + channelId + '-' + topicId] = notificationProps;

            firebase.firestore().collection('Users').doc(Datastore.User.uid).update(notificationUpdate)
            .then(function(){ console.log('Notification saved: '); })
            .catch(function(err){ console.error('Error saving notification:',err)});
        },
        registerNotifications: function(){
            firebase.messaging().getToken().then(function (currentToken) {
                if (currentToken) {
                    //firebase.database().ref('users/' + Datastore.User.uid + '/notificationTokens/' + currentToken).set(true);
                    firebase.firestore().collection('Users').doc(Datastore.User.uid).update('notificationTokens.' + currentToken, true)
                    .then(function(){ console.log('Notification token saved: '); })
                    .catch(function(err){ console.error('Error saving notification token:',err)});
                } else {
                    // Requests permission to send notifications to this browser.
                    //console.log('Requesting permission...');
                    firebase.messaging().requestPermission().then(function () {
                        //console.log('Notification permission granted.');
                        Datastore.UserFunctions.registerNotifications();
                    }).catch(function (err) {
                        //console.error('Unable to get permission to notify.', err);
                    });
                }
            }).catch(function (err) {
                console.error('Unable to get messaging token.', err);
                if (err.code === 'messaging/permission-default') {
                    //this.fcmErrorContainer.innerText = 'You have not enabled notifications on this browser. To enable notifications reload the page and allow notifications using the permission dialog.';
                } else if (err.code === 'messaging/notifications-blocked') {
                    //this.fcmErrorContainer.innerHTML = 'You have blocked notifications on this browser. To enable notifications follow these instructions: <a href="https://support.google.com/chrome/answer/114662?visit_id=1-636150657126357237-2267048771&rd=1&co=GENIE.Platform%3DAndroid&oco=1">Android Chrome Instructions</a><a href="https://support.google.com/chrome/answer/6148059">Desktop Chrome Instructions</a>';
                }
            });
        },
        setHidden: function(channelId,topicId,view,isHidden) {
            let displayUpdate = {};
            displayUpdate['displayPreferences.' + channelId + '.' + topicId + '.' + view + '.hidden'] = isHidden;

            firebase.firestore().collection('Users').doc(Datastore.User.uid).update(displayUpdate)
            .then(function(){ console.log('Topic "' + topicId + '" hidden: ' + isHidden + ' saved.'); })
            .catch(function(err){ console.error('Error saving topic visibility.',err)});
        },
        getHidden: function(channelId,topicId,view) {
            let displayPrefs = {
                hidden: false,
                override: false,
            }

            if ( Datastore.RuntimePrefs && Datastore.RuntimePrefs.showHidden ) {
                displayPrefs.override = Datastore.RuntimePrefs.showHidden;
            }
            displayPrefs.hidden = 
            (Datastore.User.hasOwnProperty('displayPreferences') && 
            Datastore.User.displayPreferences.hasOwnProperty(channelId) && 
            Datastore.User.displayPreferences[channelId].hasOwnProperty(topicId) && 
            Datastore.User.displayPreferences[channelId][topicId].hasOwnProperty(view)) &&
            Datastore.User.displayPreferences[channelId][topicId][view].hidden === true;

            return displayPrefs;
        }
    },
    AccessKeys:{},
    AccessKeyFunctions: {
        subscribe: function(){
            if ( Datastore.User.uid !== undefined ){
                // Get user's AccessKeys
                Datastore.AccessKeyFunctions.unsubscribe = Datastore.db.collection('AccessKeys').where('owner','==',Datastore.User.uid)
                .onSnapshot(function(snapshot){
                    //console.log('Got ' + snapshot.docChanges.length + ' AccessKeys changes');
                    snapshot.docChanges.forEach(function(change){
                        // console.count("Document Read");
                        let key = change.doc.data();
                        //console.log('Key ' + change.doc.id + ' ' + change.type + ' in channel ' + key.channel);
                        if (change.type === 'added' || change.type === 'modified' ){
                            if ( Datastore.AccessKeys[key.channel] == undefined ){
                                Datastore.AccessKeys[key.channel] = {};
                            }
                            Datastore.AccessKeys[key.channel][change.doc.id] = key;
                        }
                        if ( change.type === 'removed' ){
                            delete Datastore.AccessKeys[key.channel][change.doc.id];
                            if ( Object.keys(Datastore.AccessKeys[key.channel]).length < 1 ){
                                delete Datastore.AccessKeys[key.channel];
                            }
                        }
                    });
                    // Redraw after commiting changes
                    m.redraw();
                });
            }
        },
        unsubscribe: null,
        create : function(channel){
            if ( Datastore.User.uid !== undefined ){
                // Build channel request
                let request = {
                    type: 'AccessKey',
                    channelId: channel
                };
                // Store to db
                Datastore.db.collection('Requests').doc(Datastore.User.uid).collection('Requests').add(request)
                .then(function(){ console.log('New AccessKey requested'); })
                .catch(function(err){ console.error('Error requesting a new AccessKey',err)});
            }
        },
        update : function(keyId, properties) {
            Datastore.db.collection('AccessKeys').doc(keyId).update(properties)
            .then(function(){
                console.log('AccessKey updated');
            })
            .catch(function(err){
                console.error('Error updating AccessKey',err)
            })
        }
    },
    Channels: {},
    ChannelFunctions :{
        subscribe: function(){
            return new Promise( function (resolve, reject){
                // Get Channels the user can view
                Datastore.ChannelFunctions.unsubscribe = Datastore.db.collection('Channels').where('viewers.' + Datastore.User.uid,'==',true)
                .onSnapshot(function(snapshot){
                    //console.log('Got ' + snapshot.docChanges.length + ' Channels changes');
                    snapshot.docChanges.forEach(function(change){
                        // console.count("Document Read");
                        if (change.type === 'added' || change.type === 'modified' ){
                            const doc = change.doc.data();
                            const channelId = change.doc.id;
                            Datastore.Channels[channelId] = doc;

                            // Update Timeline store
                            if ( Datastore.Status.subscribed ){
                                // Loop recents in updated doc
                                for (const topic in doc.latest) {
                                    if (doc.latest.hasOwnProperty(topic)) {
                                        const event = doc.latest[topic];
                                        Datastore.Timelines.events[doc.id] = Object.assign({},{"channelId": channelId}, event);
                                    // Update latetEventTime
                                    if ( Datastore.Timelines.latestEventTime === null || event.date > Datastore.Timelines.latestEventTime ) {
                                        Datastore.Timelines.latestEventTime = event.date;
                                    }
                                    }
                                }
                            }
                        }
                        if ( change.type === 'removed' ){
                            delete Datastore.Channels[change.doc.id];
                        }
                    });
                    // Redraw after commiting changes
                    m.redraw();
                    resolve(Object.keys(Datastore.Channels));
                },function(error){
                    reject(error);
                });
            });
        },
        unsubscribe: null,
        create : function(){
            if ( Datastore.User.uid !== undefined ){
                // Build channel request
                let request = {
                    type: 'Channel'
                };
                // Store to db
                Datastore.db.collection('Requests').doc(Datastore.User.uid).collection('Requests').add(request)
                .then(function(){ console.log('New Channel requested'); })
                .catch(function(err){ console.error('Error requesting a new Channel',err)});
            }
        },
        update : function(channelId, properties) {
            Datastore.db.collection('Channels').doc(channelId).update(properties)
            .then(function(){
                console.log('Channel updated');
            })
            .catch(function(err){
                console.error('Error updating Channel',err)
            })
        }
    },
    Topics: {},
    TopicFunctions: {
        subscribe: function(channelId, topicId, eventLimit){
            const limit = eventLimit || 10;
            if ( Datastore.Topics[channelId] === undefined ){
                Datastore.Topics[channelId] = {};
            }
            if ( Datastore.Topics[channelId][topicId] === undefined ){
                Datastore.Topics[channelId][topicId] = {
                    recent: {},
                    unsubscribe: null
                };
            }

            let topicRoot = Datastore.Topics[channelId][topicId];

            // Get Channels the user can view
            topicRoot.unsubscribe = Datastore.db.collection('Channels').doc(channelId).collection('Events').where('topic','==',topicId)
            .orderBy('date','desc')
            .limit(limit)
            .onSnapshot(function(snapshot){
                console.log('Got ' + snapshot.docChanges.length + ' topic changes');
                snapshot.docChanges.forEach(function(change){
                    // console.count("Document Read");
                    if (change.type === 'added' || change.type === 'modified' ){
                        topicRoot.recent[change.doc.id] = change.doc.data();
                    }
                    if ( change.type === 'removed' ){
                        delete topicRoot.recent[change.doc.id];
                    }
                });
                // Redraw after commiting changes
                m.redraw();
            });
        },
        unsubscribe: function(channelId, topicId){
            try {
                Datastore.Topics[channelId][topicId].unsubscribe();
            } catch (error) {
                console.error("Error unsubscribing:", error);
            }

        }
    },
    Timelines: {},
    TimelineFunctions: {
        get: function(channels, timelineStart){
            return new Promise( function (resolve, reject){
                Datastore.Timelines.events = {};
                Datastore.Timelines.latestEventTime = null;
                const startDate = timelineStart || moment().startOf('day').toDate();

                // Loop the provided channels
                for (let i = 0; i < channels.length; i++) {
                    const channelId = channels[i];

                    // Get events off each channel
                    Datastore.db.collection('Channels').doc(channelId).collection('Events')
                    .where('date', '>=', startDate)
                    .orderBy('date','desc')
                    .get()
                    .then(function(snapshot){
                        console.log('Got ' + snapshot.size + ' timeline events from Channel ' + channelId);
                        snapshot.forEach(function(doc){
                            // console.count("Document Read");
                            const event = doc.data();
                            Datastore.Timelines.events[doc.id] = Object.assign({},{"channelId": channelId}, doc.data());
                            // Update latetEventTime
                            if ( Datastore.Timelines.latestEventTime === null || event.date > Datastore.Timelines.latestEventTime ) {
                                Datastore.Timelines.latestEventTime = event.date;
                            }
                        });
                        // Redraw after commiting changes
                        resolve(Datastore.Timelines.events);
                        m.redraw();
                    }, function(error){
                        reject(error);
                    });
                }
            });
        },
        // subscribe is deprecated
        subscribe: function(channels, timelineStart){
            return new Promise( function (resolve, reject){
                Datastore.Timelines.channels = {};
                const startDate = timelineStart || moment().startOf('day').toDate();

                let timelineRoot = Datastore.Timelines;

                // Get Channels the user can view
                for (let i = 0; i < channels.length; i++) {
                    const channelId = channels[i];

                    if ( timelineRoot.channels[channelId] === undefined ){
                        timelineRoot.channels[channelId] = {
                            docs: {}
                        };
                    }

                    timelineRoot.channels[channelId].unsubscribe = Datastore.db.collection('Channels').doc(channelId).collection('Events')
                    .where('date', '>=', startDate)
                    .orderBy('date','desc')
                    .onSnapshot(function(snapshot){
                        //console.log('Got ' + snapshot.docChanges.length + ' timeline changes');
                        snapshot.docChanges.forEach(function(change){
                            if (change.type === 'added' || change.type === 'modified' ){
                                const event = change.doc.data();
                                timelineRoot.channels[channelId].docs[change.doc.id] =Object.assign({},{"channelId": channelId}, change.doc.data());
                            }
                            if ( change.type === 'removed' ){
                                delete timelineRoot.channels[channelId].docs[change.doc.id];
                            }
                        });
                        // Redraw after commiting changes
                        resolve(Datastore.Timelines.channels);
                        m.redraw();
                    }, function(error){
                        reject(error);
                    });
                }
            });
        },
        unsubscribe: function(){
            try {
                for (const channelId in Datastore.Timelines.channels) {
                    if (Datastore.Timelines.channels.hasOwnProperty(channelId)) {
                        const channel = Datastore.Timelines.channels[channelId];
                        channel.unsubscribe();
                    }
                }
            } catch (error) {
                console.error("Error unsubscribing:", error);
            }

        }
    }
}

// App frame component
const Frame = {
    view: function (vnode) {
        return m('#frame', [
            m('header.navbar',
                [
                    m('.navbar-section', [
                        m('a.btn.btn-link', { onclick: function () { m.route.set('/status') } }, 'Status'),
                        m('a.btn.btn-link', { onclick: function () { m.route.set('/timeline') } }, 'Timeline'),
                        m('a.btn.btn-link', { onclick: function () { m.route.set('/profile') } }, 'Profile')
                    ]),
                    m('.navbar-section',
                        [
                            m(ConnectionStatus),
                            m('a.btn.btn-link', {
                                disabled: Datastore.User === null,
                                onclick: function () {
                                    firebase.auth().signOut().then(function () {
                                        Datastore.User = null;
                                    })
                                }
                            }, 'Sign Out')
                        ]
                    )
                ]
            ),
            vnode.children]
        )
    }
}

//Connection status indicator
const ConnectionStatus = {
    view: function (vnode) {
        return m('.connection-status', Datastore.Status.Connected ? "Connected" : "Not Connected");
    }
}

// Base component for Loading Route
const LoadingBase = {
    view: function () {
        return m('p', 'Loading...');
    }
}

// Base component for Login Route
const LoginBase = {
    view: function () {
        return m('#login', [
            m('h1', 'Sign in to continue'),
            m('button', { onclick: function () { signin() } }, 'Sign In')
        ])
    }
}
// Base component for Timeline Route
const TimelineBase = {
    view: function (vnode) {

        // Build an array of event values
        let events = Object.values(Datastore.Timelines.events);

        // Filter events
        events = events.filter((event) => {
            const displayPrefs = Datastore.UserFunctions.getHidden(event.channelId, event.topic, 'timeline');
            return displayPrefs.override || !displayPrefs.hidden;
        });

        // Sort events newest first
        events = events.sort( (a,b) => { return b.date.getTime() - a.date.getTime() });

        // Cluster events
        let eventClusters = [];
        let clusterIndex = 0;
        let lastEventTimestamp = events[0].date.getTime();
        eventClusters[clusterIndex] = {
            type:'grouped',
            events: [],
            label:''
        };

        // Create clusters when events are less than maxClusterDistance apart
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if ( lastEventTimestamp - event.date.getTime() > thresholds.maxClusterDistance ){
                clusterIndex++;
                eventClusters[clusterIndex] = {
                    type:'grouped',
                    events: [],
                    label:''
                };
            }
            eventClusters[clusterIndex].events.push(event);
            lastEventTimestamp = event.date.getTime();
        }

        // Re-cluster singles: group all adjacent single-item clusters
        let aggregatorIdx = 0;
        for (let i = 0; i < eventClusters.length; i++) {
            const cluster = eventClusters[i];
            if ( cluster.events.length < 2 ) {
                if ( aggregatorIdx > -1 && aggregatorIdx != i){
                    eventClusters[aggregatorIdx].events = eventClusters[aggregatorIdx].events.concat(cluster.events);
                    eventClusters[i].events = [];
                } else {
                    aggregatorIdx = i;
                }
            } else {
                cluster.type = 'related';
                aggregatorIdx = -1;
            }
        }
        // Filter empty clusters
        eventClusters = eventClusters.filter((val)=>{return val.events.length > 0});
        
        // Output events grouped by cluster
        let clusteredElements = [];
        for (let i = 0; i < eventClusters.length; i++) {
            let eventCluster = eventClusters[i];

            // Sort events oldest first inside related clusters
            if ( eventCluster.type == 'related' ){
                eventCluster.events = eventCluster.events.sort( (a,b) => { return a.date.getTime() - b.date.getTime() });
            }

            let eventElems = eventCluster.events.map( (event,i,events) => {
                return m(EventTile, {key: i, event: event, channelId: event.channelId, timeDisplay: (eventCluster.type == 'related' ? 'absolute' : 'relative'), last: i == events.length -1 } );
            });

            clusteredElements.push(m('.event-cluster.columns',[
                m('.column.col-12',
                (eventCluster.type == 'related' ? m('h4',moment(eventCluster.events[0].date).fromNow()) : '') ),
                eventElems]));
        }

        return m('#Timeline.container.grid-lg',clusteredElements);
        
    }
}

// Base component for Status Route
const StatusBase = {
    onupdate: function(vnode) {
        if ( Datastore.RuntimePrefs.statusFocus !== undefined && Datastore.RuntimePrefs.statusFocus !== null ){
            const focusElement = document.getElementById(Datastore.RuntimePrefs.statusFocus);
            if ( focusElement !== null ){
                setTimeout(() => {
                    focusElement.scrollIntoView({behavior: "smooth"});
                    Datastore.RuntimePrefs.statusFocus = null;
                    m.route.set('/status');
                }, 500);
                
            }
        }
    },
    view: function (vnode) {
        return m('.container.grid-xl',[
            m('a#all'),
            m('.columns',[
                m(ChannelList, {itemComponent: Channel, channels: Datastore.Channels})
            ])
        ]);
    }
}

// Base component for User Route
const ProfileBase = {
    timezoneInput: Datastore.User.timezone !== null ? Datastore.User.timezone : '',
    view: function (vnode) {
        return m('.container.grid-sm',[
            m('h2','Profile'),
            m('button.btn.btn-primary.float-right',
                { onclick: function () { Datastore.RuntimePrefs.showHidden = !Datastore.RuntimePrefs.showHidden; } },
                Datastore.RuntimePrefs.showHidden ? 'Hide Hidden Topics' : 'Show Hidden Topics'),
            m('h2','Channels'),
            m('.columns',[
                m('div.column.col-12',
                    m('button.btn.btn-primary.float-right',{ onclick: function () { Datastore.ChannelFunctions.create(); } },'Add Channel')
                ),
                m('div.column.col-12',
                    m(ChannelList, {itemComponent: ChannelEditor, channels: Datastore.Channels})
                )
            ])
        ]);
    }
}

// List of channels
const ChannelList = {
    view: function (vnode) {
        let channels = [];
        for (let key in vnode.attrs.channels) {
            if (vnode.attrs.channels.hasOwnProperty(key)) {
                let element = vnode.attrs.channels[key];
                channels.push(m(vnode.attrs.itemComponent, {'key': key, 'channelId': key, 'channel': element}));
                channels.push(m('.channel-divider.column.col-12',m('.divider')));
            }
        }
        // Pop the last divider off the channel list
        channels.pop();

        return m('.columns.channel-list',channels);
    }
}

// Individual channel
const Channel = {
    view: function (vnode) {
        let channel = vnode.attrs.channel;
        let children = [];
        children.push(m('.channel-header.column.col-12',m('h1', channel.name)));
        let panels = [];

        let sortedKeys = Object.keys(channel.latest).sort(function (a,b) {
            if ( channel.latest[a].topicType == channel.latest[b].topicType ){
                return channel.latest[a].subject < channel.latest[b].subject ? -1 : 1;
            } else {
                return channel.latest[a].topicType < channel.latest[b].topicType ? -1 : 1;
            }
        })

        // Add latest events to the channel
        sortedKeys.forEach( function(key){
            if (channel.latest.hasOwnProperty(key)) {
                let element = channel.latest[key];
                const displayPrefs = Datastore.UserFunctions.getHidden(vnode.attrs.channelId,key,'status');
                if ( displayPrefs.override || !displayPrefs.hidden ){
                    panels.push(m(EventCard, {key: key, event: element, channelId: vnode.attrs.channelId} ));
                }
            }
        });

        children.push(panels);

        return children;
    }
}

// Individual channel
const ChannelEditor = {
    oninit: function(vnode) {
        vnode.state.props = {};
        vnode.state.props.name = vnode.attrs.channel.name;
        vnode.state.props.description = vnode.attrs.channel.name;
    },
    view: function (vnode) {
        let props = vnode.state.props;
        let channel = vnode.attrs.channel;
        let channelId = vnode.attrs.channelId;

        let children = [
            m('.channel-header.column.col-12',m('h1', channel.name)),
            m('.channel-editForm.column.col-12',
                m('.form',[
                    m('.form-group', [
                        m('label.form-label','Name'),
                        m('input.form-input',{
                            type: 'text',
                            placeholder: 'Name',
                            value: props.name,
                            onchange: function(e) {
                                props.name = e.target.value;
                            }
                        }),
                    ]),
                    m('.form-group', [
                        m('label.form-label','Description'),
                        m('input.form-input',{
                            type: 'text',
                            placeholder: 'Description',
                            value: props.description,
                            onchange: function(e) {
                                props.description = e.target.value;
                            }
                        }),
                    ]),
                    m('.form-group.clearfix', [
                        m('button.btn.btn-primary.float-right',{
                            onclick: function (e) {
                                e.preventDefault();
                                Datastore.ChannelFunctions.update(channelId,props);
                            }
                    },'Save Channel'),
                    ]),
                    m('.form-group', [
                        m('h3','Keys'),
                    ]),
                    m('.form-group.clearfix', [
                        m('button.btn.btn-primary.float-right',{
                            onclick: function(e){
                                e.preventDefault();
                                Datastore.AccessKeyFunctions.create(channelId);
                            }
                        },'Add key'),
                    ]),
                    m(KeyList, {itemComponent: KeyEditor, keys: Datastore.AccessKeys[channelId]})
                ])
            )
        ];

        return children;
    }
}

// List of Access Keys
const KeyList = {
    view: function (vnode) {
        let keys = [];
        for (let key in vnode.attrs.keys) {
            if (vnode.attrs.keys.hasOwnProperty(key)) {
                let element = vnode.attrs.keys[key];
                keys.push(m(vnode.attrs.itemComponent, {'key': key, 'keyId': key, 'accessKey': element}));
            }
        }
        return m('.columns.key-list',keys);
    }
}

// Individual key
const KeyEditor = {
    oninit: function(vnode) {
        vnode.state.keyProps = {};
        vnode.state.keyProps.name = vnode.attrs.accessKey.name;
        vnode.state.keyProps.isEnabled = vnode.attrs.accessKey.isEnabled;
    },
    view: function (vnode) {
        //let key = vnode.attrs.accessKey;
        let keyId = vnode.attrs.keyId;
        
        let keyProps = vnode.state.keyProps;

        let fields = 
        m('.key-editForm.column.col-12',
            m('.form',[
                m('.form-group', [
                    m('.input-group',[
                        m('span.input-group-addon', keyId),
                        m('input.form-input[type="text"][placeholder="Name"]',{
                            value: keyProps.name,
                            onchange: function(e) {
                                keyProps.name = e.target.value;
                            }
                        }),
                    ]),
                ]),
                m('.form-group', [
                    m('label.form-switch', [
                        m('input[type="checkbox"]', {
                            checked: keyProps.isEnabled,
                            onclick: function(){
                                keyProps.isEnabled = !keyProps.isEnabled;
                            },
                            onchange: function(e) {
                                keyProps.isEnabled = e.currentTarget.checked;
                            }
                        }),
                        m('i.form-icon'),
                        m('span','Enabled')
                    ]),
                ]),
                m('.form-group.clearfix', [
                    m('button.btn.btn-primary.float-right',{
                        onclick: function (e) {
                            e.preventDefault();
                            Datastore.AccessKeyFunctions.update(keyId,keyProps);
                        }
                    },'Update')
                ]),
            ])
        )


        return fields;
    }
}

// Compact card for timeline list
const EventTile ={
    view: function (vnode) {
        let event = vnode.attrs.event;
        let channelId = vnode.attrs.channelId;
        const timeDisplay = vnode.attrs.timeDisplay;
        const isLast = vnode.attrs.last;
        let topicId = event.topic;

        const displayPrefs = Datastore.UserFunctions.getHidden(event.channelId, event.topic, 'timeline');

        let coverElement = null;
        if ( event.valueType == 'image' || event.valueType == 'image_url' ) {
            coverElement = m('.tile-cover',
                { onclick: function () { vnode.state.showModal = !vnode.state.showModal }},
                m('img.img-responsive', {'src': event.value})
            );
        }

        let valueElement = null;
        if ( event.valueType == 'image' || event.valueType == 'image_url' ) {
            valueElement = m('.tile-icon',[
                m('.event-value' + valueClasses(event),
                    m('.text-center', formatValue(event))
                ),
            m('.modal' + (vnode.state.showModal ? '.active' : ''),
                { onclick: function () { vnode.state.showModal = !vnode.state.showModal }},
                [m('.modal-overlay'),
                    m('.modal-container',m('img.img-responsive', {'src': event.value}))]
            )
        ]);
        } else {
            valueElement = m('.tile-icon',
                m('.event-value' + valueClasses(event),
                    m('.text-center', formatValue(event))
                )
            );
        }

        if ( !event.delay ){
            event.delay = event.received - event.date;
        }
        
        let headerElement = m('.tile-content',[
            m('.tile-title',[
                m('span', event.subject)
            ]),
            m('.tile-subtitle.text-gray',
                ( timeDisplay == 'relative' ? 
                    [m('.text-small.tooltip.tooltip-bottom', {
                        'data-tooltip': moment(event.date).format("dddd, MMM Do, h:mm:ssa")
                    },
                    moment(event.date).fromNow() + (event.delay > thresholds.maxAcceptableDelay ? " (delayed " + moment.duration(event.delay).humanize() + ")" : "" )),
                    ] :
                    m('.text-small',moment(event.date).format("h:mm:ssa") + (event.delay > thresholds.maxAcceptableDelay ? " (delayed " + moment.duration(event.delay).humanize() + ")" : "" ))
                ) 
            )
        ]);

        let actionElement = m('.tile-action',
            m('.dropdown.dropdown-right' + (vnode.state.showMenu ? '.active' : ''),[
                //<a href="#" class="btn btn-link dropdown-toggle" tabindex="0">
                m('a.dropdown-toggle',
                    { href: '#', tabindex: 0 },
                    //{ onclick: function () { vnode.state.showMenu = !vnode.state.showMenu },
                    //  onblur: function () { vnode.state.showMenu = false }},
                    m('i.material-icons.type-icon','more_vert'),
                ),
                m('ul.menu',[
                    m('li.menu-item', { onclick: function () {
                        Datastore.UserFunctions.setHidden(channelId,topicId,'timeline',!displayPrefs.hidden);
                    }}, (displayPrefs.hidden ? 'UnHide' : 'Hide'))
                ])
            ])
        );

        let tile = 
            m('#' + channelId + '-' + topicId + '.tile-container.column.' + (isLast ? 'col-mr-auto' : '') + '.col-md-6.col-4.col-xs-12'+ (displayPrefs.hidden ? '.hidden' : ''),
            [
                coverElement,
                m('.tile.' + event.valueType,[
                    valueElement,
                    headerElement,
                    actionElement
                ])
            ]);

        return tile;

    }
};

// Card showing a single event and the option to view history for events in the same topic
const EventCard = {
    view: function (vnode) {
        let event = vnode.attrs.event;
        let channelId = vnode.attrs.channelId;
        let topicId = event.topic;

        const displayPrefs = Datastore.UserFunctions.getHidden(channelId, topicId, 'status');

        let notificationPreference = Datastore.User.notificationPreferences[channelId + '-' + topicId] !== undefined ? 
            Datastore.User.notificationPreferences[channelId + '-' + topicId].frequency : 
            'never';

        let valueElement = null;
        if ( event.valueType == 'image' || event.valueType == 'image_url' ) {
            valueElement = [m('.card-image',
                { onclick: function () { vnode.state.showModal = !vnode.state.showModal }},
                m('img.img-responsive', {'src': event.value})
            ),
            m('.modal' + (vnode.state.showModal ? '.active' : ''),
                { onclick: function () { vnode.state.showModal = !vnode.state.showModal }},
                [m('.modal-overlay'),
                    m('.modal-container',m('img.img-responsive', {'src': event.value}))]
            )
        ];
        } else {
            valueElement = m('.card-body.event-value' + valueClasses(event),
                m('.text-center', formatValue(event))
            );
        }

        if ( !event.delay ){
            event.delay = event.received - event.date;
        }

        let headerElement = m('.card-header.d-flex',[
            m('.card-title',[
                m('span', event.subject),
                m('.text-small.tooltip', {
                    'data-tooltip': moment(event.date).format("dddd, MMM Do, h:mma"),
                    'onclick': function () { vnode.state.showHistory = !vnode.state.showHistory }
                }, moment(event.date).fromNow() + (event.delay > thresholds.maxAcceptableDelay ? " (delayed " + moment.duration(event.delay).humanize() + ")" : "" )),
                m('.event-history', m('i.material-icons.type-icon',
                { onclick: function () { vnode.state.showHistory = !vnode.state.showHistory }}, 
                'history'))
            ]),
            m('.event-icon', m('i.material-icons.type-icon', mdIcons[event.topicType])),
            m('.event-expand', m('i.material-icons.type-icon',
                { onclick: function () { vnode.state.showMenu = !vnode.state.showMenu }}, 
                'more_vert'))
        ]);

        let menuElement = m('.modal' + (vnode.state.showMenu ? '.active' : ''),//m('.card-body',
        [m('.modal-overlay',{ onclick: function () { vnode.state.showMenu = !vnode.state.showMenu }}),
        m('.modal-container',
            m('table.event-menu.table.table-striped.table-hover', [
                m('tr',
                    { onclick: function () {
                        vnode.state.showHistory = !vnode.state.showHistory;
                        vnode.state.showMenu = false;
                    }},
                    m('td', (vnode.state.showHistory ? 'Hide' : 'Show') + ' History')
                ),
                m('tr',
                    { onclick: function () {
                        vnode.state.showMeta = !vnode.state.showMeta;
                        vnode.state.showMenu = false;
                    }},
                    m('td', (vnode.state.showMeta ? 'Hide' : 'Show') + ' Meta')
                ),
                m('tr',
                    { onclick: function () {
                        const frequencies = ['never','once', 'always'];
                        let index = frequencies.indexOf(notificationPreference);
                        let nextPref = frequencies[++index % frequencies.length]
                        

                        Datastore.UserFunctions.setNotificationPreference(channelId,topicId, nextPref);
                    }}, 
                    m('td', 'Notify: ' + (notificationPreference === undefined ? 'never' : notificationPreference) )
                ),
                m('tr',
                    { onclick: function () {
                        Datastore.UserFunctions.setHidden(channelId,topicId,'status',!displayPrefs.hidden);
                    }},
                    m('td', displayPrefs.hidden ? 'unHide' : 'Hide')
                ),
            ])
        )]
        );

        //let historyElement = m('.card-body',m(EventHistory, {channelId: vnode.attrs.channelId, event: event}));

        let historyElement = m('.modal' + (vnode.state.showHistory ? '.active' : ''),
            [m('.modal-overlay',{ onclick: function () { vnode.state.showHistory = !vnode.state.showHistory }}),
            m('.modal-container',
                [ m('.modal-header',m('.close.btn.btn-clear.float-right',{ onclick: function () { vnode.state.showHistory = !vnode.state.showHistory }})),
                m(EventHistory, {channelId: vnode.attrs.channelId, event: event})]
            )]
        );

        let metaElement = m('.modal' + (vnode.state.showMeta ? '.active' : ''),
            [m('.modal-overlay',{ onclick: function () { vnode.state.showMeta = !vnode.state.showMeta }}),
                m('.modal-container',m(KeyValueTable,{event: event}))
            ]
        );

        let standardCols = '.col-md-6.col-lg-4.col-3';
        if ( event.valueType == 'image' || event.valueType == 'image_url' ){
            standardCols = '.col-md-6.col-lg-4.col-4';
        }
        let mobileCols = 'col-xs-6'; //vnode.state.showHistory ? 'col-xs-12' : 'col-xs-6';

        let card = m('#' + channelId + '-' + topicId + '.channel-event.column.' + event.valueType + '.' + mobileCols + standardCols,
            m('.card.eventCard' + (displayPrefs.hidden ? '.hidden':''),[
                valueElement,
                headerElement,
                vnode.state.showMenu ? menuElement : null, // menu visibility
                vnode.state.showHistory ? historyElement : null, // history visibility
                vnode.state.showMeta ? metaElement : null
            ])
        );

        return card;
    }
}


const EventHistory = {
    history: [],
    oncreate: function (vnode) {
        let limit = 10;
        if (vnode.attrs.event.valueType === 'temperature' ||
            vnode.attrs.event.valueType === 'temperature-status' ||
            vnode.attrs.event.valueType === 'humidity' ||
            vnode.attrs.event.valueType === 'humidity-status') {
            limit = 24;
        }
        
        Datastore.TopicFunctions.subscribe(vnode.attrs.channelId,vnode.attrs.event.topic, limit);
    },
    onremove: function(vnode){
        Datastore.TopicFunctions.unsubscribe(vnode.attrs.channelId,vnode.attrs.event.topic);
    },
    view: function (vnode) {
        let showTable = true;
        let history = {};
        try {
            history = Datastore.Topics[vnode.attrs.channelId][vnode.attrs.event.topic].recent;
        } catch (error) {
            console.error("No recent events found.");
        }
        
        var children = [];

        if (vnode.attrs.event.valueType === 'temperature' ||
            vnode.attrs.event.valueType === 'temperature-status' ||
            vnode.attrs.event.valueType === 'humidity' ||
            vnode.attrs.event.valueType === 'humidity-status') {
            let tempValues = [];
            let tempLabels = [];
            //for (var i = 0; i < history.length; i++) {
            for ( let i in history ){
                tempValues.unshift(history[i].value);
                tempLabels.unshift(formatValue(history[i], true));
            };
            children.unshift(m('tr', m('td', { 'colspan': 2 }, m(SparkLine, { values: tempValues, labels: tempLabels }))));
        } else if ( vnode.attrs.event.valueType === 'image_url' ) {
            children.unshift(m('tr', m('td', { 'colspan': 2 },m(ImageTimeline,history))));
            showTable = false;
        }

        if ( showTable ) {
            for( let i in history ){
                children.push(m(HistoryIndicator, history[i]));
            };
        }

        return m('table.history.table.table-striped.table-hover', children.slice(0,9));
    }
}

const StatusIndicator = {
    showHistory: false,
    view: function (vnode) {
        var classes = ['', 'card', 'sensor'];

        if (moment(vnode.attrs.date).isSameOrAfter(moment().subtract('1', 'hours'))) {
            classes.push('recent');
        }
        var children = [
            m('.card-header',
                [m('.card-title.flex',
                    [
                        m('div', vnode.attrs.display_name),
                        m('div', m('i.material-icons.type-icon', mdIcons[vnode.attrs.name]))
                    ]
                ),
                m('.card-subtitle.tooltip', { 'data-tooltip': moment(vnode.attrs.date).format("dddd, MMM Do, h:mma") }, moment(vnode.attrs.date).fromNow())
                ]
            ),
            m('a.card-body', { onclick: function () { vnode.state.showHistory = !vnode.state.showHistory }, href: '#' + vnode.attrs.id },
                [
                    m('.value ' + valueClasses(vnode.attrs), [formatValue(vnode.attrs), m('.action.history.float-right', m('i.material-icons', 'history'))]),
                ]
            ),
        ];

        if (vnode.state.showHistory) {
            classes.push('withHistory');
            children.push(m(EventHistory, vnode.attrs));
        }

        return m('#' + vnode.attrs.id + classes.join('.'), children);
    }
}

const HistoryIndicator = {
    view: function (vnode) {
        var eventDate = moment(vnode.attrs.date);
        var children = [
            m('td.time', eventDate.isSame(moment(), 'day') ? eventDate.format('LT') : eventDate.calendar()),
            m('td.value.event-value ' + valueClasses(vnode.attrs), formatValue(vnode.attrs))
        ];

        return m('tr.record', children);
    }
}

const ImageIconWithModal = {
    view: function (vnode) {
        let children = [m('.card-image.clickable',
                { onclick: function () { vnode.state.showModal = !vnode.state.showModal }},
                m('div',m('i.material-icons.type-icon', 'image')),
            ),
            m('.modal' + (vnode.state.showModal ? '.active' : ''),
                { onclick: function () { vnode.state.showModal = !vnode.state.showModal }},
                [m('.modal-overlay'),
                    m('.modal-container',m('img.img-responsive', {'src': vnode.attrs.event.value}))]
            )
        ];

        return m('div', children);
    }
}

const KeyValueTable = {
    view: function (vnode) {
        let meta = vnode.attrs.event.meta;
        
        var children = [];

        for( let key in meta ){
            let val = meta[key];
            if ( typeof val === "object" ){
                val = m(KeyValueTable,{event:{meta:val}});
            }
            if ( typeof val === "string" && val.indexOf('http') === 0 ){
                val = m('a', {href:val}, val)
            }
            children.push(m('tr',[
                m('td.key', key),
                m('td.value', val)
            ]));
        };
        
        return m('table.keyvalue.table.table-striped.table-hover', children);
    }
}

const ImageTimeline = {
    oninit : function (vnode){
        vnode.state.imgIndex = 0;
        vnode.state.loadedImgs = {};
    },
    view: function (vnode){
        const imageEvents = vnode.attrs;
        let children = [];
        let count = 0;
        for( let i in imageEvents){
            const event = imageEvents[i];
            const imgKey = "imgkey-" + i;
            if ( count.toString() == this.imgIndex ){
                var eventDate = moment(event.date);
                children.push(
                    m('p',
                        (eventDate.isSame(moment(), 'day') ? eventDate.format('LT') : eventDate.calendar()) + (this.loadedImgs[imgKey] === true ? "" : " loading...")
                    )
                );
                children.push(m('img', {
                    'src': event.value,
                    'data-key': "imgkey-" + i,
                    onload: m.withAttr("data-key", function(v){
                        vnode.state.loadedImgs[v] = true;
                    })
                }));
            }
            count++;
        };
        children.push(m('input',{
            'type': 'range',
            'min': 0,
            'max': count - 1,
            'value': this.imgIndex,
            oninput: m.withAttr("value", function(v){
                vnode.state.imgIndex = v;
            })
        }));
        return m('div.imagetimeline',children);
    }
}

const SparkLine = {
    view: function (vnode) {

        let points = vnode.attrs.hasOwnProperty('values') ? vnode.attrs.values.map(function (val, idx) { return 100 - val }) : [5, 10, 15, 10, 5];
        let labels = vnode.attrs.hasOwnProperty('labels') ? vnode.attrs.labels : vnode.attrs.values;
        let interval = 10;
        let svgPoints = '';
        let ymin = Math.min(...points);
        let ymax = Math.max(...points);
        let markers = [];
        for (var i = 0; i < points.length; i++) {
            let x = (i * interval);
            let y = points[i];
            svgPoints += x + ',' + y + ' ';
            markers.push(null);
        }
        let line = m('polyline',
        {
            'fill': 'none',
            'stroke': '#0074d9',
            'stroke-width': '1',
            'points': svgPoints
        });
        // only show one each min/max markers
        let hasMax = false;
        let hasMin = false;
        for (var i = points.length - 1; i >= 0; i--) {
            if ( hasMax && hasMin) {
                break;
            }
            if ( points[i] === ymin && !hasMin ){
                let x = (i * interval);
                let y = points[i];
                markers.push(m('text', {
                    'x': x,
                    'y': y,
                    'dx': 1,
                    'dy': -2,
                    'fill': '#ffffff',
                    'text-anchor': 'middle'
                },labels[i]));
                hasMin = true;
            }
            if ( points[i] === ymax && !hasMax ){
                let x = (i * interval);
                let y = points[i];
                markers.push(m('text', {
                    'x': x,
                    'y': y,
                    'dx': 1,
                    'dy': 10,
                    'fill': '#ffffff',
                    'text-anchor': 'middle'
                },labels[i]));
                hasMax = true;
            }
        }
        ymin = ymin - 12;
        ymax = ymax + 12;

        let svgViewbox = '-' + interval + ' ' + ymin + ' ' + (interval * (points.length + 1)) + ' ' + (ymax - ymin);
        if (points.length > 0) {
            return m('.sparkline', m('svg',
                { 'viewBox': svgViewbox },
                [line].concat(markers)));
        } else {
            return '';
        }
    }
}

function valueClasses(event) {
    var classes = [];

    switch (event.valueType) {
        case 'motion':
        case 'motion-status':
            classes.push(event.value === 'active' ? 'active' : 'inactive');
            break;
        case 'presence':
        case 'presence-status':
            classes.push(event.value === 'present' ? 'active' : 'inactive');
            break;
        case 'contact':
        case 'contact-status':
            classes.push(event.value === 'open' ? 'negative' : 'positive');
            break;
        case 'water':
        case 'water-status':
            classes.push(event.value === 'dry' ? 'positive' : 'negative');
            break;
        case 'lock':
        case 'lock-status':
            classes.push(event.value === 'locked' ? 'positive' : 'negative');
            break;
        case 'switch':
        case 'switch-status':
            classes.push(event.value === 'on' ? 'active' : 'inactive');
            break;
        case 'number-percent':
            if ( event.topicType === 'battery_status'){
                classes.push(event.value < 15 ? 'negative' : 'positive');
            }
            break;
        case 'humidity-status':
            classes.push(event.value < 25 || event.value > 45 ? 'negative' : 'positive');
            break;
        case 'temperature':        
        case 'temperature-status':
            var round = Math.floor(parseFloat(event.value) / 10) * 10;
            classes.push('temperature-' + round);
            break;
        case 'illuminance-status':
            classes.push(event.value > 50 ? 'positive' : 'inactive');
            break;
    }

    return ".val-" + classes.join('.val-');
}

function formatValue(event, simple) {
    var formatted = event.value

    var val = isNumeric(event.value) ? Math.floor(event.value * 100) / 100 : event.value;
    var unit = "";

    if ( event.hasOwnProperty('meta') && event.meta.hasOwnProperty('unit') && event.meta.unit !== null ){
        unit = event.meta.unit;
    }

    if ( unit !== '' && unit !== null ){
        if ( simple === true ){
            formatted = val + unit;
        } else {
            formatted = m('span',[
                m('span',val),
                m('sup.text-small',' ' + unit)
            ]);
        }
    } else {
        formatted = simple === true ? val : m('span',val);
    }

    switch (event.valueType) {
        case 'presence':
        case 'presence-status':
            formatted = event.value === 'present' ? 'present' : 'away';
            break;
        case 'motion':
        case 'motion-status':
            formatted = event.value === 'active' ? 'motion' : 'no motion';
            break;
        case 'temperature':
        case 'temperature-status':
            if ( simple === true ){
                formatted = Math.round(event.value) + '° ' + unit;
            } else {
                formatted = m('span',[
                    m('span',Math.round(event.value) + '° '),
                    m('sup.text-small',unit)
                ]);
            }
            break;
        case 'image_url':
            if ( simple === true ){
                formatted = '[image]';
            } else {
                formatted = m(ImageIconWithModal, { event: event });
            }
            break;
        case 'number-percent':
        case 'humidity-status':
            if ( simple === true ){
                formatted = event.value + '%';
            } else {
                formatted = m('div',[
                    m('div.te.text-center', event.value + '%'),
                    m('.bar.bar-sm',
                        m('.bar-item', {'style': {'width': event.value + '%'}})
                    )
                ]);
            }
            break;
    }

    if ( event.topicType === 'wunderground_weather' ){
        formatted = simple === true ? event.message : m('.text-small',event.message);
    }

    return formatted;
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
  }

// Saves the token to the database if available. If not request permissions.
let saveToken = function () {
    firebase.messaging().getToken().then(function (currentToken) {
        if (currentToken) {
            //firebase.database().ref('users/' + Datastore.User.uid + '/notificationTokens/' + currentToken).set(true);
        } else {
            // Requests permission to send notifications to this browser.
            //console.log('Requesting permission...');
            firebase.messaging().requestPermission().then(function () {
                //console.log('Notification permission granted.');
                saveToken();
            }).catch(function (err) {
                //console.error('Unable to get permission to notify.', err);
            });
        }
    }).catch(function (err) {
        console.error('Unable to get messaging token.', err);
        if (err.code === 'messaging/permission-default') {
            //this.fcmErrorContainer.innerText = 'You have not enabled notifications on this browser. To enable notifications reload the page and allow notifications using the permission dialog.';
        } else if (err.code === 'messaging/notifications-blocked') {
            //this.fcmErrorContainer.innerHTML = 'You have blocked notifications on this browser. To enable notifications follow these instructions: <a href="https://support.google.com/chrome/answer/114662?visit_id=1-636150657126357237-2267048771&rd=1&co=GENIE.Platform%3DAndroid&oco=1">Android Chrome Instructions</a><a href="https://support.google.com/chrome/answer/6148059">Desktop Chrome Instructions</a>';
        }
    });
};

// Set up app
const appRoot = document.getElementById('app-root');
m.route.prefix('?');
m.route(appRoot, '/loading', {
    '/loading': {
        render: function () {
            return m(Frame, m(LoadingBase))
        },
    },
    '/status': {
        render: function (vnode) {
            Datastore.RuntimePrefs.statusFocus = null;
            return m(Frame, m(StatusBase))
        },
    },
    '/status/:tag': {
        render: function (vnode) {
            Datastore.RuntimePrefs.statusFocus = vnode.attrs.tag;
            return m(Frame, m(StatusBase))
        },
    },
    '/timeline': {
        onmatch: function(){
            if ( !Datastore.Status.subscribed ){
                m.route.set('/loading');
            }
        },
        render: function (vnode) {
            return m(Frame, m(TimelineBase))
        },
    },
    '/login': {
        render: function () {
            return m(Frame, m(LoginBase))
        },
    },
    '/profile': {
        render: function () {
            return m(Frame, m(ProfileBase))
        },
    },
});
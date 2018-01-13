'use strict';

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
    'switch': 'lightbulb_outline',
    'temperature': 'ac_unit',
    'lock': 'lock',
    'smartthings-contact': 'flip',
    'smartthings-motion': 'visibility',
    'smartthings-presence': 'account_box',
    'smartthings-switch': 'lightbulb_outline',
    'smartthings-temperature': 'ac_unit',
    'smartthings-lock': 'lock'
}

// Model
let Datastore = {
    db: null,
    init: function(user){
        Datastore.db = firebase.firestore();
        // Get user record, send to status or user config
        Datastore.db.collection('Users').doc(user.uid).get()
        .then(function(doc){
            if ( doc.exists ){
                // Found user
                console.log("User successfully loaded.");
                Datastore.User = doc.data();
                m.route.set('/status');
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
            saveToken();

            // Set up connections
            Datastore.AccessKeyFunctions.populate();
            Datastore.ChannelFunctions.populate();
        })
        .catch(function(error){
            console.error("Error retrieving user: ", error);
        });
    },
    Status: {
        Connected: false
    },
    User: {},
    UserFunctions: {
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
        setNotificationPreference: function (deviceId, preference) {
            let notificationUpdate = {};
            notificationUpdate['notificationPreferences.' + deviceId] = preference;

            firebase.firestore().collection('Users').doc(Datastore.User.uid).update(notificationUpdate)
            .then(function(){ console.log('Notification saved: '); })
            .catch(function(err){ console.error('Error saving notification:',err)});
        }
    },
    AccessKeys:{},
    AccessKeyFunctions: {
        populate: function(){
            if ( Datastore.User.uid !== undefined ){
                // Get users AccessKeys, then Channels, then latest events
                Datastore.db.collection('AccessKeys').where('owner','==',Datastore.User.uid)
                .onSnapshot(function(snapshot){
                    console.log('Got ' + snapshot.docChanges.length + ' AccessKeys changes');
                    snapshot.docChanges.forEach(function(change){
                        if (change.type === 'added' || change.type === 'modified' ){
                            Datastore.AccessKeys[change.doc.id] = change.doc.data();
                        }
                        if ( change.type === 'removed' ){
                            delete Datastore.AccessKeys[change.doc.id];
                        }
                    });
                    // Redraw after commiting changes
                    m.redraw();
                });
            }
        }
    },
    Channels: {},
    ChannelFunctions :{
        populate: function(){
            // Get Channels the user can view
            Datastore.db.collection('Channels').where('viewers.' + Datastore.User.uid,'==',true)
            .onSnapshot(function(snapshot){
                console.log('Got ' + snapshot.docChanges.length + ' Channels changes');
                snapshot.docChanges.forEach(function(change){
                    if (change.type === 'added' || change.type === 'modified' ){
                        Datastore.Channels[change.doc.id] = change.doc.data();
                    }
                    if ( change.type === 'removed' ){
                        delete Datastore.Channels[change.doc.id];
                    }
                });
                // Redraw after commiting changes
                m.redraw();
            });
            
        }
    },
    Topics: {},
    TopicFunctions: {
        subscribe: function(channelId, topicId){
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
            .limit(10)
            .onSnapshot(function(snapshot){
                console.log('Got ' + snapshot.docChanges.length + ' topic changes');
                snapshot.docChanges.forEach(function(change){
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
                        m('a.btn.btn-link', { onclick: function () { m.route.set('/profile') } }, 'Profile')
                    ]),
                    m('.navbar-section',
                        [
                            m(ConnectionStatus),
                            m('.loginout', m('button', {
                                disabled: Datastore.User === null,
                                onclick: function () {
                                    firebase.auth().signOut().then(function () {
                                        Datastore.User = null;
                                    })
                                }
                            }, 'Sign Out'))
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

// Base component for User Route
const ProfileBase = {
    timezoneInput: Datastore.User.timezone !== null ? Datastore.User.timezone : '',
    view: function (vnode) {
        return m('#profile.frame-body',
            m('.panel', [
                m('.panel-header', m('.panel-title', Datastore.User.displayName)),
                m('.panel-body', [
                    m('dl', [
                        m('dt', 'WebHook Key'),
                        m('dd', Datastore.User.webhookKey)
                    ]),
                    m('dl', [
                        m('dt', 'Time Zone'),
                        m('dd', [
                            m('input[type=text]', {
                                oninput: m.withAttr('value', function (value) { vnode.state.timezoneInput = value }),
                                value: vnode.state.timezoneInput !== undefined ? vnode.state.timezoneInput : Datastore.User.timezone
                            }),
                            m('button', {
                                onclick: function () {
                                    vnode.state.timezoneInput = Intl.DateTimeFormat().resolvedOptions().timeZone;
                                    m.redraw();
                                }
                            }, 'Use Timezone from this device'),
                            m('button', {
                                onclick: function () {
                                    Datastore.UserFunctions.setTimezone(vnode.state.timezoneInput);
                                }
                            }, 'Save')
                        ])
                    ])
                ]),
            ]));
    }
}

// List of channels
const ChannelList = {
    view: function (vnode) {
        let channels = [];
        for (let key in vnode.attrs.channels) {
            if (vnode.attrs.channels.hasOwnProperty(key)) {
                let element = vnode.attrs.channels[key];
                channels.push(m(Channel, {channelId: key, channel: element}));
            }
        }

        return m('div', channels);
    }
}

// Individual channel
const Channel = {
    view: function (vnode) {
        let channel = vnode.attrs.channel;
        let children = [];
        children.push(m('h1', channel.name));
        let panels = [];

        let sortedKeys = Object.keys(channel.latest).sort(function (a,b) {
            //return channel.latest[a].subject > channel.latest[b].subject ? -1 : 1;
            if ( channel.latest[a].topicType == channel.latest[b].topicType ){
                return channel.latest[a].subject < channel.latest[b].subject ? -1 : 1;
            } else {
                return channel.latest[a].topicType < channel.latest[b].topicType ? -1 : 1;
            }
        })

        //for (let key in channel.latest) {
        sortedKeys.forEach( function(key){
            if (channel.latest.hasOwnProperty(key)) {
                let element = channel.latest[key];
                panels.push(m(EventCard, {event: element, channelId: vnode.attrs.channelId} ));
            }
        });

        children.push(m('.container.grid-xl.channel',m('.columns',panels)));

        return m('div', children);
    }
}
/*
<div class="card">
  <div class="card-image">
    <img src="img/osx-el-capitan.jpg" class="img-responsive">
  </div>
  <div class="card-header">
    <div class="card-title h5">Microsoft</div>
    <div class="card-subtitle text-gray">Software and hardware</div>
  </div>
  <div class="card-body">
    Empower every person and every organization on the planet to achieve more.
  </div>
  <div class="card-footer">
    <button class="btn btn-primary">Do</button>
  </div>
</div>
*/
// Card showing a single event and the option to view history for events in the same topic
const EventCard = {
    view: function (vnode) {
        let event = vnode.attrs.event;

        let valueElement = null;
        if ( event.valueType == 'image' ) {
            valueElement = m('.card-image',
                m('img.img-responsive', {'src': event.value})
            );
        } else {
            valueElement = m('.card-body',
                m('.h1.text-center', formatValue(event))
            );
        }

        let headerElement = m('.card-header.d-flex',[
            m('.card-title',[
                m('div.h3', event.subject),
                m('.tooltip', { 'data-tooltip': moment(event.date).format("dddd, MMM Do, h:mma") }, moment(event.date).fromNow())
            ]),
            m('div.h1', m('i.material-icons.type-icon', mdIcons[event.topicType]))
            
        ]);

        let card = m('.column.col-xs-12.col-md-6.col-lg-4.col-3',
            m('.card.eventCard',[
                valueElement,
                headerElement,
                m('.card-body',m(EventHistory, {channelId: vnode.attrs.channelId, event: event}))
            ])
        );

        return card;
    }
}


const EventHistory = {
    history: [],
    oncreate: function (vnode) {
        Datastore.TopicFunctions.subscribe(vnode.attrs.channelId,vnode.attrs.event.topic);
    },
    onremove: function(vnode){
        Datastore.TopicFunctions.unsubscribe(vnode.attrs.channelId,vnode.attrs.event.topic);
    },
    view: function (vnode) {
        let history = {};
        try {
            history = Datastore.Topics[vnode.attrs.channelId][vnode.attrs.event.topic].recent;
        } catch (error) {
            
        }
        
        var children = [];

        if (vnode.attrs.eventvalueType === 'temperature' || vnode.attrs.event.valueType === 'temperature-status') {
            let tempValues = [];
            //for (var i = 0; i < history.length; i++) {
            for ( let i in history ){
                tempValues.unshift(history[i].value);
                children.push(m(HistoryIndicator, history[i]));
            };
            children.unshift(m('tr', m('td', { 'colspan': 2 }, m(SparkLine, { points: tempValues }))));
        } else {

            //for (var i = 0; i < history.length; i++) {
            for( let i in history ){
                children.push(m(HistoryIndicator, history[i]));
            };
        }

        return m('table.history.table.table-striped.table-hover', children);
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
            m('td.value ' + valueClasses(vnode.attrs), formatValue(vnode.attrs))
        ];

        return m('tr.record', children);
    }
}

const SparkLine = {
    view: function (vnode) {

        let points = vnode.attrs.hasOwnProperty('points') ? vnode.attrs.points.map(function (val, idx) { return 100 - val }) : [5, 10, 15, 10, 5];
        let interval = 10;
        let svgPoints = '';
        let ymin = Math.min(...points);
        let ymax = Math.max(...points);
        for (var i = 0; i < points.length; i++) {
            svgPoints += (i * interval) + ',' + points[i] + ' ';
        }
        ymin = ymin - 1;
        ymax = ymax + 1;

        let svgViewbox = '0 ' + ymin + ' ' + (interval * (points.length - 1)) + ' ' + (ymax - ymin);
        if (points.length > 0) {
            return m('.sparkline', m('svg',
                { 'viewBox': svgViewbox },
                m('polyline',
                    {
                        'fill': 'none',
                        'stroke': '#0074d9',
                        'stroke-width': '1',
                        'points': svgPoints
                    })));
        } else {
            return '';
        }
    }
}

function valueClasses(event) {
    var classes = [];

    switch (event.name) {
        case 'motion':
            classes.push(event.value === 'active' ? 'active' : 'inactive');
            break;
        case 'presence':
            classes.push(event.value === 'present' ? 'active' : 'inactive');
            break;
        case 'contact':
            classes.push(event.value === 'open' ? 'negative' : 'positive');
            break;
        case 'lock':
            classes.push(event.value === 'locked' ? 'positive' : 'negative');
            break;
        case 'switch':
            classes.push(event.value === 'on' ? 'active' : 'inactive');
            break;
        case 'temperature':
            var round = Math.floor(parseFloat(event.value) / 10) * 10;
            classes.push('temperature-' + round);
            break;
    }
    return classes.join(' ');
}

function formatValue(event) {
    var formatted = event.value;
    switch (event.valueType) {
        case 'presence':
        case 'presence-status':
            formatted = event.value === 'present' ? 'present' : 'away';
            break;
        case 'temperature':
        case 'temperature-status':
            formatted = Math.round(event.value) + '°';
            break;
        case 'number-percent':
        case 'humidity-status':
            formatted = m('div',[
                m('div.h3.text-center', event.value + '%'),
                m('.bar',
                    m('.bar-item', {'style': {'width': event.value + '%'}})
                )
            ]);
            break;
    }

    return formatted;
}

// Saves the token to the database if available. If not request permissions.
let saveToken = function () {
    firebase.messaging().getToken().then(function (currentToken) {
        if (currentToken) {
            firebase.database().ref('users/' + Datastore.User.uid + '/notificationTokens/' + currentToken).set(true);
        } else {
            requestPermission();
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

// Requests permission to send notifications on this browser.
let requestPermission = function () {
    //console.log('Requesting permission...');
    firebase.messaging().requestPermission().then(function () {
        //console.log('Notification permission granted.');
        saveToken();
    }).catch(function (err) {
        //console.error('Unable to get permission to notify.', err);
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
        render: function () {
            return m(Frame, m(ChannelList, {channels: Datastore.Channels}))
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
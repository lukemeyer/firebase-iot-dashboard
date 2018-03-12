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
    'smartthings-lock': 'lock',
    'smartthings-illuminance': 'wb_sunny',
    'battery_status': 'battery_std',
    'smartthings-humidity': 'opacity',
    'smartthings-button': 'radio_button_checked',
    'smartthings-energy': 'power',
    'wunderground_weather': 'cloud'
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
            Datastore.UserFunctions.registerNotifications();

            // Set up connections
            Datastore.UserFunctions.subscribe();
            Datastore.AccessKeyFunctions.subscribe();
            Datastore.ChannelFunctions.subscribe();
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
        setHidden: function(channelId,topicId,isHidden) {
            let displayUpdate = {};
            displayUpdate['displayPreferences.' + channelId + '.' + topicId + '.hidden'] = isHidden;

            firebase.firestore().collection('Users').doc(Datastore.User.uid).update(displayUpdate)
            .then(function(){ console.log('Topic "' + topicId + '" visibility saved.'); })
            .catch(function(err){ console.error('Error saving topic visibility.',err)});
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
            // Get Channels the user can view
            Datastore.ChannelFunctions.unsubscribe = Datastore.db.collection('Channels').where('viewers.' + Datastore.User.uid,'==',true)
            .onSnapshot(function(snapshot){
                //console.log('Got ' + snapshot.docChanges.length + ' Channels changes');
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

// Base component for Status Route
const StatusBase = {
    view: function (vnode) {
        return m('.container.grid-xl',[
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
/*         return m('#profile.frame-body',
            m('.panel', [
                m('.panel-header', m('.panel-title', Datastore.User.displayName)),
                m('.panel-body', [
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
            ])); */
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

        // Get display prefs for this channel
        let channelDisplayPrefs = (Datastore.User.displayPreferences && Datastore.User.displayPreferences[vnode.attrs.channelId]) || {};

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
                let topicDisplayPrefs = channelDisplayPrefs && channelDisplayPrefs[key] || {hidden: false};
                let topicIsVisible = Datastore.RuntimePrefs.showHidden || !topicDisplayPrefs.hidden;
                if ( topicIsVisible ){
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

// Card showing a single event and the option to view history for events in the same topic
const EventCard = {
    view: function (vnode) {
        let event = vnode.attrs.event;
        let channelId = vnode.attrs.channelId;
        let topicId = event.topic;

        let isHidden = Datastore.User.displayPreferences && Datastore.User.displayPreferences[channelId] && Datastore.User.displayPreferences[channelId][topicId] && Datastore.User.displayPreferences[channelId][topicId].hidden;
        
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

        let headerElement = m('.card-header.d-flex',[
            m('.card-title',[
                m('span', event.subject),
                m('.text-small.tooltip', { 'data-tooltip': moment(event.date).format("dddd, MMM Do, h:mma") }, moment(event.date).fromNow())
            ]),
            m('.event-icon', m('i.material-icons.type-icon', mdIcons[event.topicType])),
            m('.event-expand', m('i.material-icons.type-icon',
                { onclick: function () { vnode.state.showMenu = !vnode.state.showMenu }}, 
                vnode.state.showMenu ? 'expand_less' : 'expand_more'))
        ]);

        let menuElement = m('.card-body',
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
                        const frequencies = ['never','once', 'always'];
                        let index = frequencies.indexOf(notificationPreference);
                        let nextPref = frequencies[++index % frequencies.length]
                        

                        Datastore.UserFunctions.setNotificationPreference(channelId,topicId, nextPref);
                    }}, 
                    m('td', 'Notify: ' + (notificationPreference === undefined ? 'never' : notificationPreference) )
                ),
                m('tr',
                    { onclick: function () {
                        Datastore.UserFunctions.setHidden(channelId,topicId,!isHidden);
                    }},
                    m('td', isHidden ? 'unHide' : 'Hide')
                ),
            ])
        );

        let historyElement = m('.card-body',m(EventHistory, {channelId: vnode.attrs.channelId, event: event}));

        let mobileCols = vnode.state.showHistory ? 'col-xs-12' : 'col-xs-6';

        let card = m('.channel-event.column.' + mobileCols + '.col-md-6.col-lg-4.col-3',
            m('.card.eventCard' + (isHidden ? '.hidden':''),[
                vnode.state.showMenu ? menuElement : null, // menu visibility
                valueElement,
                headerElement,
                vnode.state.showHistory ? historyElement : null // history visibility
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
            m('td.value.event-value ' + valueClasses(vnode.attrs), formatValue(vnode.attrs))
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

    return "." + classes.join('.');
}

function formatValue(event) {
    var formatted = event.value

    var val = isNumeric(event.value) ? Math.floor(event.value * 100) / 100 : event.value;
    var unit = "";

    if ( event.hasOwnProperty('meta') && event.meta.hasOwnProperty('unit') ){
        unit = event.meta.unit;
    }

    if ( unit !== '' && unit !== null ){
        formatted = m('span',[
            m('span',val),
            m('sup.text-small',' ' + unit)
        ]);
    } else {
        formatted = m('span',val);
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
            formatted = m('span',[
                m('span',Math.round(event.value) + '° '),
                m('sup.text-small',unit)
            ]);
            break;
        case 'image_url':
            formatted = m('a',{'href': event.value, 'target': '_blank'},[
                m('div', m('i.material-icons.type-icon', 'image'))
            ]);
            break;
        case 'number-percent':
        case 'humidity-status':
            formatted = m('div',[
                m('div.te.text-center', event.value + '%'),
                m('.bar.bar-sm',
                    m('.bar-item', {'style': {'width': event.value + '%'}})
                )
            ]);
            break;
    }

    if ( event.topicType === 'wunderground_weather' ){
        formatted = m('.text-small',event.message);
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
        render: function () {
            return m(Frame, m(StatusBase))
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
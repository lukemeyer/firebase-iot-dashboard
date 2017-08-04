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
    'lock': 'lock'
}

// Model
let Datastore = {
    Status: {
        Connected: false
    },
    User: {
        location_id: null
    },
    UserFunctions: {
        setLocationId: function (value) {
            Datastore.User.location_id = value;
        },
        setTimezone: function (value) {
            // Validate
            try {
                new Date().toLocaleString("en-US", { timeZone: value, timeZoneName: "long" });
                Datastore.User.timezone = value;
                // Store to firebase
                firebase.database().ref('users/' + Datastore.User.uid + '/timezone').set(value);

            } catch (e) {
                console.log(e);
            }

        },
        setNotificationPreference: function (deviceId, preference) {
            firebase.database().ref('users/' + Datastore.User.uid + '/notificationPreferences/' + deviceId).set(preference);
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
    oncreate: function (vnode) {
        if (typeof firebase === 'undefined') {
            m.route.set('/loading');
        } else {
            saveToken();
            firebase.messaging().onMessage(function (payload) {
                console.log('Notifications received.', payload);
            });
            vnode.state.dbRef = firebase.database().ref('/users/' + Datastore.User.uid);

            vnode.state.dbRef.once('value', function (snapshot) {
                Datastore.User = snapshot.val();
                m.redraw();
            });
        }
    },
    onremove: function (vnode) {
        if (typeof vnode.state.dbRef !== 'undefined') {
            // Clean up db ref
            vnode.state.dbRef.off();
        }

    },
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

// Base component for Status Route
const StatusBase = {
    events: [],
    oncreate: function (vnode) {
        if (typeof firebase === 'undefined') {
            m.route.set('/loading');
        } else {
            let location_id = Datastore.User.location_id;
            let statusPath = 'status/' + location_id;

            vnode.state.dbRef = firebase.database().ref(statusPath);

            vnode.state.events = [];

            vnode.state.dbRef.orderByChild('name').on('child_added', function (snapshot) {
                var event = snapshot.val();
                vnode.state.events[snapshot.key] = event;
                m.redraw();
            });

            vnode.state.dbRef.on('child_changed', function (snapshot) {
                let event = snapshot.val();
                vnode.state.events[snapshot.key] = event;
                m.redraw();
            });
        }
    },
    onremove: function (vnode) {
        if (typeof vnode.state.dbRef !== 'undefined') {
            // Clean up db ref
            vnode.state.dbRef.off();
        }
    },
    view: function (vnode) {
        let children = [];
        for (let key in vnode.state.events) {
            if (vnode.state.events.hasOwnProperty(key)) {
                let element = vnode.state.events[key];
                children.push(m('.flex-list-item', m(StatusIndicator, element)));
            }
        }

        return m('#status.flex-list', children);
    }
}

const StatusHistory = {
    history: [],
    oncreate: function (vnode) {
        vnode.state.dbRef = firebase.database().ref('/events/' + vnode.attrs.location_id + '/' + vnode.attrs.name)
            .orderByChild('id').equalTo(vnode.attrs.id)
            .limitToLast(5);
        vnode.state.history = [];

        vnode.state.dbRef.on('child_added', function (snapshot) {
            var event = snapshot.val();
            vnode.state.history.unshift(event);
            m.redraw();
        });

        vnode.state.dbRef.on('child_removed', function (snapshot) {
            var event = snapshot.val();
            delete vnode.state.history[snapshot.key];
            m.redraw();
        });
    },
    view: function (vnode) {
        var children = [];

        if (vnode.attrs.name === 'temperature') {
            let tempValues = [];
            for (var i = 0; i < vnode.state.history.length; i++) {
                tempValues.unshift(vnode.state.history[i].value);
                children.unshift(m(HistoryIndicator, vnode.state.history[i]));
            }
            children.unshift(m('tr', m('td', { 'colspan': 2 }, m(SparkLine, { points: tempValues }))));
        } else {

            for (var i = 0; i < vnode.state.history.length; i++) {
                children.push(m(HistoryIndicator, vnode.state.history[i]));

            }
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
            children.push(m(StatusHistory, vnode.attrs));
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
    switch (event.name) {
        case 'presence':
            formatted = event.value === 'present' ? 'present' : 'away';
            break;
        case 'temperature':
            formatted = Math.round(event.value) + '°';
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
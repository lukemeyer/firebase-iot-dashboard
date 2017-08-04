// Auth with Google through firebase
var provider = new firebase.auth.GoogleAuthProvider();

// Handle sign-in event
function signin() {
    firebase.auth().signInWithPopup(provider).then(function (result) {
        // This gives you a Google Access Token. You can use it to access the Google API.
        var token = result.credential.accessToken;
        // The signed-in user info.
        var user = result.user;

    }).catch(function (error) {
        // Handle Errors here.
        console.error('Sign in error');
        console.log(error);
    });
}

// Listen for Auth change to get data
firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
        // User is signed in.

        //Keep track of connection status
        let connectionDBref = firebase.database().ref(".info/connected");

        connectionDBref.on('value', function (snapshot) {
            Datastore.Status.Connected = snapshot.val() === true;
        });
        
        // Get user record from firebase DB and check for location id, route to user config if not found, store user on datastore if found
        firebase.database().ref('/users/' + user.uid).once('value', function (snapshot) {
            let fbUser = snapshot.val();
            if ( fbUser !== null && fbUser.hasOwnProperty('location_id') && fbUser.location_id !== null ){
                Datastore.User = fbUser;
                m.route.set('/status');
            } else {
                Datastore.User = {'displayName': user.displayName, 'uid': user.uid};
                firebase.database().ref('/users/' + user.uid).set(Datastore.User).then(function() {
                    m.route.set('/profile');
                });
            }
        });

    } else {
        // User is signed out.
        m.route.set('/login');
    }
});
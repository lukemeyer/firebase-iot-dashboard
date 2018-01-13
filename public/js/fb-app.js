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
        Datastore.init(user);

        //Keep track of connection status
        let connectionDBref = firebase.database().ref(".info/connected");

        connectionDBref.on('value', function (snapshot) {
            Datastore.Status.Connected = snapshot.val() === true;
        });

    } else {
        // User is signed out.
        m.route.set('/login');
    }
});
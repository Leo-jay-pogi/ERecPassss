/* ERecPass Firebase Auth Client
 * Handles Firebase email verification and new-device login confirmation.
 */
(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: "AIzaSyD21h5PXdV2Q9m5BUrcEWpfdhyfXDXv4Tc",
    authDomain: "erecpass-portal.firebaseapp.com",
    projectId: "erecpass-portal",
    storageBucket: "erecpass-portal.firebasestorage.app",
    messagingSenderId: "198857226274",
    appId: "1:198857226274:web:d1c939a7163dcc7db6327b",
    measurementId: "G-7K9LF9NG7Q"
  };

  let fbAuth = null;

  function initFirebase() {
    if (typeof firebase === 'undefined') {
      console.warn('[ERecPass Firebase] Firebase SDK not loaded yet.');
      return null;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      fbAuth = firebase.auth();
      return fbAuth;
    } catch (err) {
      console.error('[ERecPass Firebase] Initialization error:', err);
      return null;
    }
  }

  // Attempt initial setup
  if (typeof firebase !== 'undefined') {
    initFirebase();
  } else {
    window.addEventListener('DOMContentLoaded', initFirebase);
  }

  window.ERecPassFirebase = {
    isConfigured: function () {
      if (!fbAuth) initFirebase();
      return !!fbAuth;
    },

    getAuth: function () {
      if (!fbAuth) initFirebase();
      return fbAuth;
    },

    /**
     * Registers user with Firebase and dispatches a verification confirmation email.
     */
    registerAndSendConfirmation: async function (email, password, displayName) {
      const auth = this.getAuth();
      if (!auth) {
        throw new Error('Firebase Authentication is not available. Please check your internet connection.');
      }

      let userCred;
      try {
        userCred = await auth.createUserWithEmailAndPassword(email, password);
      } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
          // If already in Firebase, attempt to sign in to resend or report
          try {
            userCred = await auth.signInWithEmailAndPassword(email, password);
          } catch (loginErr) {
            throw new Error('This email address is already registered. Please log in or use Forgot Password.');
          }
        } else if (err.code === 'auth/invalid-email') {
          throw new Error('The email address format is not valid.');
        } else if (err.code === 'auth/weak-password') {
          throw new Error('The password is too weak. Please use at least 8 characters with symbols.');
        } else {
          throw err;
        }
      }

      const user = userCred.user;
      if (displayName && user.updateProfile) {
        try {
          await user.updateProfile({ displayName: displayName });
        } catch (_) {}
      }

      // Do not attach a continue URL. Firebase will show its own
      // "email verified" confirmation page instead of returning to ERecPass.
      try {
        await user.sendEmailVerification();
      } catch (verifyErr) {
        console.error('[ERecPass Firebase] sendEmailVerification error:', verifyErr);
        throw verifyErr;
      }

      // Sign out from Firebase immediately so unverified session is not kept active
      await auth.signOut();
      return { success: true, email: email };
    },

    /**
     * Checks if the patient's email has been verified.
     * For existing accounts not registered in Firebase, allows legacy login gracefully.
     */
    checkEmailVerification: async function (email, password) {
      const auth = this.getAuth();
      if (!auth) {
        return { verified: true, bypassed: true };
      }

      try {
        const userCred = await auth.signInWithEmailAndPassword(email, password);
        const user = userCred.user;
        // Reload user state to get latest emailVerified status
        await user.reload();
        const isVerified = !!user.emailVerified;
        await auth.signOut();

        return {
          verified: isVerified,
          email: email,
          displayName: user.displayName || ''
        };
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          // Legacy account created in Supabase before Firebase integration
          return { verified: true, legacy: true };
        }
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
          return { error: 'Invalid email or password.', code: err.code };
        }
        if (err.code === 'auth/too-many-requests') {
          return { error: 'Too many failed login attempts. Please try again later.', code: err.code };
        }
        console.warn('[ERecPass Firebase] checkEmailVerification error:', err);
        return { error: 'Could not check email verification. Please check your connection and try again.', code: err.code };
      }
    },

    /**
     * Resends the verification confirmation email.
     */
    resendVerificationEmail: async function (email, password) {
      const auth = this.getAuth();
      if (!auth) throw new Error('Firebase service not available.');

      const userCred = await auth.signInWithEmailAndPassword(email, password);
      const user = userCred.user;
      await user.sendEmailVerification();
      await auth.signOut();
      return true;
    },

    /**
     * Dispatches a new device login confirmation email via Firebase.
     */
    sendNewDeviceConfirmationEmail: async function (email, confirmUrl) {
      const auth = this.getAuth();
      if (!auth) throw new Error('Firebase Authentication is not available.');

      try {
        await auth.sendSignInLinkToEmail(email, {
          url: confirmUrl,
          handleCodeInApp: true
        });
      } catch (err) {
        if (err.code === 'auth/operation-not-allowed') {
          throw new Error('Firebase Email link sign-in is disabled. Enable Email link sign-in in the Firebase Authentication sign-in methods.');
        }
        console.error('[ERecPass Firebase] Could not send device confirmation email:', err);
        throw err;
      }
      return true;
    }
  };
})();

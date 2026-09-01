import { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const AuthContext = createContext();

// The main account signs in client-side and has no Firebase session. The server
// recognises it by the signed session cookie /api/ash-login sets; this flag is
// only what tells the UI which account is active.
export const ASH_UID = 'ash';

const ASH_PROFILE = {
  uid: ASH_UID,
  displayName: 'Ash',
  email: 'ash@i-ash.com',
  photoURL: '/assets/ash-avatar.jpg'
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Check for Ash's login first
      const isAshLoggedIn = localStorage.getItem('isAshLoggedIn');

      if (isAshLoggedIn) {
        setUser(ASH_PROFILE);
        setLoading(false);
        return;
      }

      if (user) {
        // Check if user is verified or is a Google user
        if (user.emailVerified || user.providerData?.[0]?.providerId === 'google.com') {
          // Set default avatar if no photoURL exists
          setUser({
            ...user,
            photoURL: user.photoURL || '/assets/default-avatar.jpg'
          });
        } else {
          // If not verified, sign them out
          await auth.signOut();
          setUser(null);
        }
      } else {
        setUser(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

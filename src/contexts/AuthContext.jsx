import { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const AuthContext = createContext();

// The main account signs in with a Firebase custom token minted by
// /api/ash-login, so it holds a real session (and a real ID token) under this
// uid rather than a client-side flag.
export const ASH_UID = 'ash';

const ASH_PROFILE = {
  displayName: 'Ash',
  email: 'ash@i-ash.com',
  photoURL: '/assets/ash-avatar.jpg'
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Custom-token users have no provider entries and no verified email, so
      // the verification gate below must not apply to them.
      if (user.uid === ASH_UID) {
        setUser({ ...user, ...ASH_PROFILE });
        setLoading(false);
        return;
      }

      const providerId = user.providerData?.[0]?.providerId;

      if (user.emailVerified || providerId === 'google.com') {
        setUser({
          ...user,
          photoURL: user.photoURL || '/assets/default-avatar.jpg'
        });
      } else {
        // Unverified email accounts are not allowed to stay signed in.
        await auth.signOut();
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

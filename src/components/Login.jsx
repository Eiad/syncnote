import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { auth, logAnalyticsEvent } from '@/lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { FiMail, FiLock } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import styles from './Login.module.scss';
import { useAuth } from '@/contexts/AuthContext';
import GlobalLoader from './GlobalLoader';
import SignUp from './SignUp';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ashPassword, setAshPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loginMode, setLoginMode] = useState('email'); // 'ash' or 'email'
  const [success, setSuccess] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const { executeRecaptcha } = useGoogleReCaptcha();
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Redirect to dashboard if user is already authenticated
  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  /**
   * Handle Ash-only login with analytics tracking
   * Tracks login attempts, success, and failures for the special Ash user
   */
  const handleAshLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // console.log('🔐 Ash login attempt started...');

    // Track Ash login attempts for security monitoring
    logAnalyticsEvent('login_attempted', {
      login_method: 'ash',                    // Special login method for Ash
      user_email: 'ash@syncnote.com'         // Fixed email for Ash user
    });

    try {
      // The password is checked server-side so it is never inlined into the
      // client bundle. A successful check sets the signed session cookie the
      // Cloudinary routes authenticate against.
      const response = await fetch('/api/ash-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ashPassword })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || 'Invalid password');

        // Track failed Ash login attempts for security monitoring
        logAnalyticsEvent('login_failed', {
          login_method: 'ash',                // Special login method
          error_type: 'invalid_password',     // Type of failure
          user_email: 'ash@syncnote.com'     // Fixed email for Ash user
        });
        return;
      }

      localStorage.setItem('isAshLoggedIn', 'true');

      // Track successful Ash login for admin access monitoring
      logAnalyticsEvent('login_success', {
        login_method: 'ash',                // Special login method
        user_email: 'ash@syncnote.com'     // Fixed email for Ash user
      });

      // console.log('🚀 Redirecting to dashboard...');
      window.location.href = '/dashboard';
    } catch (error) {
      // console.log('💥 Ash login error:', error);
      setError('Login failed: ' + error.message);
      
      // Track Ash login errors for debugging
      logAnalyticsEvent('login_error', {
        login_method: 'ash',                  // Special login method
        error_message: error.message,         // Specific error message
        user_email: 'ash@syncnote.com'       // Fixed email for Ash user
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle email/password login with comprehensive analytics tracking
   * Tracks login attempts, success, failures, and email verification status
   */
  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // console.log('🔐 Email login attempt started...', { email });

    // Track email login attempts for user behavior analysis
    logAnalyticsEvent('login_attempted', {
      login_method: 'email',                  // Standard email login method
      user_email: email                       // User's email address
    });

    try {
      // Verify reCAPTCHA in production for security
      if (!isDevelopment) {
        if (!executeRecaptcha) {
          throw new Error('reCAPTCHA not initialized');
        }

        const token = await executeRecaptcha('login');
        const recaptchaResponse = await fetch('/api/verify-recaptcha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const recaptchaData = await recaptchaResponse.json();
        if (!recaptchaData.success || recaptchaData.score < 0.5) {
          throw new Error('Security check failed. Please try again.');
        }
      }

      // console.log('🔑 Attempting Firebase authentication...');
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Check if email is verified before allowing login
      if (!userCredential.user.emailVerified) {
        // console.log('❌ Email not verified');
        setError('Please verify your email address before logging in.');
        await auth.signOut();
        
        // Track unverified email login attempts for user guidance
        logAnalyticsEvent('login_failed', {
          login_method: 'email',              // Standard email login method
          error_type: 'email_not_verified',   // Type of failure
          user_email: email                   // User's email address
        });
        
        setLoading(false);
        return;
      }
      
      // console.log('✅ Email login successful:', userCredential.user.email);
      
      // Track successful email login for user engagement analysis
      logAnalyticsEvent('login_success', {
        login_method: 'email',                // Standard email login method
        user_email: email,                    // User's email address
        user_id: userCredential.user.uid,     // User's unique identifier
        user_display_name: userCredential.user.displayName // User's display name
      });
      
      // Also send standard Firebase login event for better DebugView visibility
      logAnalyticsEvent('login', {
        method: 'email'
      });
      
      router.push('/dashboard');
    } catch (error) {
      // console.log('💥 Email login error:', error);
      let errorType = 'unknown';
      switch (error.code) {
        case 'auth/invalid-email':
          setError('Invalid email address.');
          errorType = 'invalid_email';
          break;
        case 'auth/user-disabled':
          setError('This account has been disabled.');
          errorType = 'user_disabled';
          break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          setError('Invalid email or password.');
          errorType = 'invalid_credentials';
          break;
        default:
          setError(error.message);
          errorType = 'other';
      }
      
      // Track failed email login attempts for security and UX analysis
      // console.log('📊 Sending login_failed analytics event:', {
      //   login_method: 'email',
      //   error_type: errorType,
      //   error_code: error.code,
      //   user_email: email
      // });
      
      logAnalyticsEvent('login_failed', {
        login_method: 'email',                // Standard email login method
        error_type: errorType,                // Type of failure
        error_code: error.code,               // Firebase error code
        user_email: email                     // User's email address
      });
      
      // console.log('✅ login_failed event sent to analytics');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle Google OAuth login with analytics tracking
   * Tracks Google login attempts, success, and failures
   */
  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    
    // console.log('Google login attempt started...');
    
    // Track Google login attempts for OAuth usage analysis
    logAnalyticsEvent('login_attempted', {
      login_method: 'google'                  // Google OAuth login method
    });
    
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      
      // console.log('🔑 Opening Google popup...');
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        // console.log('✅ Google login successful:', result.user.email);
        
        // Track successful Google login for OAuth adoption analysis
        logAnalyticsEvent('login_success', {
          login_method: 'google',             // Google OAuth login method
          user_email: result.user.email,      // User's email from Google
          user_id: result.user.uid,           // User's unique identifier
          user_display_name: result.user.displayName // User's display name from Google
        });
        
        router.push('/dashboard');
      }
    } catch (error) {
      // console.log('💥 Google login error:', error);
      // console.error('Google Sign In Error:', error);
      setError('Failed to sign in with Google: ' + error.message);
      
      // Track failed Google login attempts for OAuth troubleshooting
      logAnalyticsEvent('login_failed', {
        login_method: 'google',               // Google OAuth login method
        error_type: 'google_signin_failed',   // Type of failure
        error_message: error.message          // Specific error message
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle password reset requests with analytics tracking
   * Tracks reset attempts, success, and failures
   */
  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }
    
    setLoading(true);
    setError('');
    
    // Track password reset requests for user support analysis
    logAnalyticsEvent('password_reset_requested', {
      user_email: email                       // User's email address
    });
    
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess('Password reset link has been sent to your email.');
      setTimeout(() => setSuccess(''), 5000);
      
      // Track successful password reset emails for delivery monitoring
      logAnalyticsEvent('password_reset_email_sent', {
        user_email: email                     // User's email address
      });
    } catch (error) {
      let errorType = 'unknown';
      switch (error.code) {
        case 'auth/invalid-email':
          setError('Invalid email address.');
          errorType = 'invalid_email';
          break;
        case 'auth/user-not-found':
          setError('No account found with this email.');
          errorType = 'user_not_found';
          break;
        default:
          setError('Failed to send reset email. Please try again.');
          errorType = 'other';
      }
      
      // Track password reset errors for troubleshooting
      logAnalyticsEvent('password_reset_error', {
        error_type: errorType,                // Type of error
        error_code: error.code,               // Firebase error code
        user_email: email                     // User's email address
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle login mode switching with analytics tracking
   * Tracks user preferences between Ash-only and email login modes
   */
  const handleLoginModeChange = (mode) => {
    setLoginMode(mode);
    
    // Track login mode changes for UX analysis
    logAnalyticsEvent('login_mode_changed', {
      from_mode: loginMode,                   // Previous login mode
      to_mode: mode                           // New login mode
    });
  };

  /**
   * Handle signup page navigation with analytics tracking
   * Tracks user interest in account creation
   */
  const handleSignUpToggle = () => {
    setIsSignUp(true);
    
    // Track signup page access for conversion analysis
    logAnalyticsEvent('signup_page_accessed');
  };

  if (isSignUp) {
    return <SignUp onToggleMode={() => setIsSignUp(false)} />;
  }

  return (
    <>
      {loading && <GlobalLoader message="Logging in..." />}
      <div className={styles.loginContainer}>
        <div className={styles.loginCard}>
          <div className={styles.logoSection}>
            <h1 className={styles.logo}>SyncNote</h1>
            <p className={styles.tagline}>Your collaborative workspace</p>
          </div>

          <div className={styles.loginModeToggle}>
            <button
              className={`${styles.modeButton} ${loginMode === 'ash' ? styles.activeMode : ''}`}
              onClick={() => handleLoginModeChange('ash')}
            >
              Ash Only
            </button>
            <button
              className={`${styles.modeButton} ${loginMode === 'email' ? styles.activeMode : ''}`}
              onClick={() => handleLoginModeChange('email')}
            >
              Email Login
            </button>
          </div>

          {loginMode === 'ash' ? (
            <form onSubmit={handleAshLogin} className={styles.form}>
              <div className={styles.inputGroup}>
                <FiLock className={styles.inputIcon} />
                <input
                  type="password"
                  value={ashPassword}
                  onChange={(e) => setAshPassword(e.target.value)}
                  placeholder="Enter password for Ash"
                  className={styles.input}
                  required
                />
              </div>
              
              <button 
                type="submit" 
                className={styles.primaryButton}
                disabled={loading}
              >
                {loading ? 'Logging in...' : 'Login as Ash'}
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={handleEmailLogin} className={styles.form}>
                <div className={styles.inputGroup}>
                  <FiMail className={styles.inputIcon} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    className={styles.input}
                    required
                  />
                </div>
                
                <div className={styles.inputGroup}>
                  <FiLock className={styles.inputIcon} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className={styles.input}
                    required
                  />
                </div>
                
                <button 
                  type="submit" 
                  className={styles.primaryButton}
                  disabled={loading}
                >
                  {loading ? 'Logging in...' : 'Login'}
                </button>
              </form>

              <div className={styles.divider}>
                <span>or</span>
              </div>

              <button 
                onClick={handleGoogleLogin}
                className={styles.googleButton}
                disabled={loading}
              >
                <FcGoogle className={styles.googleIcon} />
                Continue with Google
              </button>

              <div className={styles.forgotPassword}>
                <button 
                  type="button" 
                  onClick={handleForgotPassword}
                  className={styles.forgotPasswordButton}
                >
                  Forgot Password?
                </button>
              </div>
            </>
          )}

          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>{success}</div>}

          <div className={styles.signupSection}>
            <p>Don't have an account?</p>
            <button 
              onClick={handleSignUpToggle}
              className={styles.switchButton}
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;
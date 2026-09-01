import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { auth, logAnalyticsEvent } from '@/lib/firebase';
import { FiLogOut, FiEdit3, FiImage, FiSave, FiTrash2, FiX, FiZap } from 'react-icons/fi';
import TextShare from '@/components/TextShare';
import MediaShare from '@/components/MediaShare';
import GlobalLoader from '@/components/GlobalLoader';
import QuickNote from '@/components/QuickNote';
import FileShare from '@/components/FileShare';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import AlertMonitor from '@/components/AlertMonitor';
import styles from '@/styles/Home.module.scss';

const Dashboard = () => {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeTab, setActiveTab] = useState('media'); // Default to media share

  /**
   * Test analytics function for debugging
   */
  const testAnalytics = () => {
    // console.log('🧪 Testing analytics...');
    logAnalyticsEvent('test_event', {
      test_param: 'test_value',
      timestamp: Date.now()
    });
  };

  /**
   * Track when user accesses the dashboard
   * This event helps understand user engagement and session patterns
   * Fires once per dashboard access, not on every render
   */
  useEffect(() => {
    if (user && !authLoading) {
      logAnalyticsEvent('dashboard_accessed', {
        user_id: user.uid,                    // Unique user identifier for tracking
        user_email: user.email,               // User's email for demographic analysis
        user_display_name: user.displayName   // Display name for user identification
      });
    }
  }, [user, authLoading]);

  /**
   * Handle user logout with comprehensive analytics tracking
   * Tracks logout success, errors, and session duration
   */
  const handleLogout = async () => {
    // console.log('Logout attempt started...');
    setLoggingOut(true);
    const startTime = Date.now(); // Track session duration
    
    // Track logout attempt with session duration
    logAnalyticsEvent('user_logout', {
      user_id: user?.uid,                    // User identifier
      user_email: user?.email,               // User email
      session_duration: Date.now() - startTime // How long user was logged in
    });
    
    try {
      // console.log('🔐 Signing out from Firebase...');
      await auth.signOut();
      localStorage.removeItem('isAshLoggedIn');
      // Drop the server-side session cookie too, so the browser stops
      // presenting a credential the user has signed out of.
      await fetch('/api/ash-logout', { method: 'POST' }).catch(() => {});

      // Ensure minimum loading time for better UX
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(1500 - elapsedTime, 0);
      await new Promise(resolve => setTimeout(resolve, remainingTime));
      
      // console.log('🏠 Redirecting to home...');
      window.location.href = '/';
    } catch (error) {
      // console.log('💥 Logout error:', error);
      // console.error('Logout failed:', error);
      
      // Track logout errors to identify authentication issues
      logAnalyticsEvent('logout_error', {
        error_message: error.message,         // Specific error message
        user_id: user?.uid                    // User identifier for debugging
      });
    } finally {
      setLoggingOut(false);
    }
  };

  /**
   * Handle tab switching with analytics tracking
   * Helps understand which features users prefer and navigation patterns
   */
  const handleTabSwitch = (tabName) => {
    setActiveTab(tabName);
    
    // Track tab switching to understand user preferences
    logAnalyticsEvent('tab_switched', {
      from_tab: activeTab,                   // Previous tab (e.g., 'media', 'files')
      to_tab: tabName,                       // New tab user switched to
      user_id: user?.uid                     // User identifier for personalization
    });
  };

  // Redirect to home if user is not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <>
      {loggingOut && <GlobalLoader message="Logging out..." />}
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <h1 className={styles.syncNote}>SyncNote</h1>
            <div className={styles.userSection}>
              <div className={styles.userInfo}>                
                <span className={styles.userName}>{user.displayName}</span>
              </div>
              {user.photoURL && (
                <div className={styles.avatarContainer}>
                  <img 
                    src={user.photoURL} 
                    alt="Profile" 
                    className={styles.avatar}
                  />
                </div>
              )}
              <button 
                onClick={handleLogout}
                className={styles.logoutButton}
                title="Sign Out"
              >
                <span className={styles.desktopText}>Sign Out</span>
                <FiLogOut className={styles.logoutIcon} />
              </button>
            </div>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.textareaContainer}>
            <QuickNote documentId={`${user.uid}-quicknotes`} />
            <TextShare documentId={`${user.uid}-notes`} />
          </div>
          {user.displayName === 'Ash' && (
          <div className={styles.tabContainer}>
            <button 
              className={`${styles.tabButton} ${activeTab === 'media' ? styles.activeTab : ''}`} 
              onClick={() => handleTabSwitch('media')}
            >
              Media Share
            </button>            
            
              <button 
                className={`${styles.tabButton} ${activeTab === 'files' ? styles.activeTab : ''}`} 
                onClick={() => handleTabSwitch('files')}
              >
                File Share
              </button>
            
          </div>
        )}
          {activeTab === 'media' && <MediaShare documentId={`${user.uid}-media`} />}
          {activeTab === 'files' && <FileShare documentId={`${user.uid}-files`} />}
        </main>
        <div className={styles.welcomeSection}>
          <div className={styles.featureCards}>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <FiZap />
              </div>
              <h3>Real-time Collaboration</h3>
              <p>Experience seamless real-time updates across all your devices. Log in from anywhere to see your content sync instantly.</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <FiImage />
              </div>
              <h3>Media Sharing</h3>
              <p>Share images effortlessly. Simply drag & drop, paste, or upload media files. Perfect for visual collaboration.</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <FiEdit3 />
              </div>
              <h3>Text Sync</h3>
              <p>Write, edit, and share text in real-time. Your notes automatically sync across all devices and collaborators.</p>
            </div>
          </div>
        </div>
        <footer className={styles.dashboardFooter}>
          <div className={styles.footerContent}>
            <p>© {new Date().getFullYear()} SyncNote. All rights reserved.</p>
            {/* <p className={styles.developerCredit}>Developed with ❤️ by Ash</p> */}
          </div>
        </footer>
      </div>
      
      {/* Analytics Dashboard - Only visible to Ash for testing and monitoring */}
      {/* <AnalyticsDashboard /> */}
      
      {/* Alert Monitor - Only visible to Ash for proactive monitoring */}
      {/* <AlertMonitor /> */}
      
      {/* Test Analytics Button - Only for Ash */}
      {/* {user.displayName === 'Ash' && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '120px',
          display: 'flex',
          flexDirection: 'row',
          gap: '8px',
          zIndex: 1000
        }}>
          <button 
            onClick={testAnalytics}
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: '120px',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
            }}
          >
            🧪 Test Analytics
          </button>
          <button 
            onClick={() => {
              logAnalyticsEvent('debug_event', {
                debug_param: 'manual_test',
                timestamp: Date.now()
              });
            }}
            style={{
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              color: 'white',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              boxShadow: '0 4px 12px rgba(245, 87, 108, 0.3)',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: '120px',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 6px 16px rgba(245, 87, 108, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 12px rgba(245, 87, 108, 0.3)';
            }}
          >
            🔍 Debug Event
          </button>
          <button 
            onClick={() => {
              logAnalyticsEvent('page_view', {
                page_title: 'Manual Page View',
                page_location: window.location.href
              });
            }}
            style={{
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
              color: 'white',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              boxShadow: '0 4px 12px rgba(79, 172, 254, 0.3)',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: '120px',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 6px 16px rgba(79, 172, 254, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 12px rgba(79, 172, 254, 0.3)';
            }}
          >
            📄 Page View
          </button>
        </div>
      )} */}
    </>
  );
};

export default Dashboard; 
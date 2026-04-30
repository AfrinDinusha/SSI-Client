import { useEffect, useState } from "react";

function LoginPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check if Catalyst SDK is available
        if (typeof window.catalyst === 'undefined' || !window.catalyst.auth) {
          console.log('Catalyst SDK not available in LoginPage');
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }

        const auth = await window.catalyst.auth.isUserAuthenticated();
        console.log('LoginPage auth status:', auth);
        setIsAuthenticated(!!auth);
      } catch (err) {
        console.error('LoginPage auth check failed:', err);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };
    
    // Add a timeout to ensure we don't wait forever
    const timeoutId = setTimeout(() => {
      console.log('LoginPage authentication check timeout');
      setIsAuthenticated(false);
      setIsLoading(false);
    }, 5000); // 5 second timeout
    
    // Add a small delay to ensure Catalyst SDK is loaded
    const timer = setTimeout(checkAuth, 100);
    
    return () => {
      clearTimeout(timer);
      clearTimeout(timeoutId);
    };
  }, []);

  const handleLogin = () => {
    try {
      if (typeof window.catalyst === 'undefined' || !window.catalyst.auth) {
        console.error('Catalyst SDK not available for login');
        alert('Authentication service is not available. Please refresh the page and try again.');
        return;
      }
      window.catalyst.auth.signIn(); // This will trigger the Catalyst login flow
    } catch (err) {
      console.error('Login failed:', err);
      alert('Login failed. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.2rem', color: '#3f51b5' }}>
        Checking authentication...
      </div>
    );
  }

  if (isAuthenticated) {
    window.location.href = "/";
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <h2>Login Required</h2>
      <button onClick={handleLogin} style={{ padding: '10px 24px', fontSize: '1rem', background: '#3f51b5', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        Login with Zoho Catalyst
      </button>
    </div>
  );
}

export default LoginPage;
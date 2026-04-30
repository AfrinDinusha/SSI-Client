import LoginPage from "./LoginPage.js";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function Layout() {
  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuthenticated = await window.catalyst.auth.isUserAuthenticated();
        console.log('Layout auth check:', isAuthenticated);
        
        if (isAuthenticated) {
          setIsUserAuthenticated(true);
          window.location.href = window.origin + "/app/";
          return;
        }
        
        setIsUserAuthenticated(false);
      } catch (err) {
        console.error('Authentication error:', err);
        setIsUserAuthenticated(false);
      } finally {
        setIsFetching(false);
      }
    };

    checkAuth();
  }, []);

  if (isFetching) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '1.2rem',
        color: '#3f51b5'
      }}>
        Loading...
      </div>
    );
  }

  if (!isUserAuthenticated) {
    return <LoginPage />;
  }

  return null;
}

export default Layout;
import { useCallback } from "react";
import "./Button.css";
function Button({ title, className }) {
  const logout = useCallback((e) => {
    e.preventDefault();
    const redirectURL = "/__catalyst/auth/login";
    window.catalyst.auth.signOut(redirectURL);
  }, []);
  return (
    <button onClick={logout} className={`logout-btn ${className || ''}`} aria-label="Logout">
      {/* SVG logout icon */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 19C7.58172 19 4 15.4183 4 11C4 6.58172 7.58172 3 12 3C13.6569 3 15.1566 3.63214 16.2426 4.75736" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}
export default Button;
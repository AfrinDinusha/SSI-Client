import React from 'react';
import payslipLogo from './assets/SSI Payslip logo.png';

/**
 * Logo and "S.S. INDUSTRIES" text for the right side of the header.
 * Used across all pages with the cms-header.
 */
function HeaderBranding() {
  return (
    <div className="cms-header-branding">
      <img src={payslipLogo} alt="SSI" className="cms-header-payslip-logo" />
      <span className="cms-header-branding-text">S.S. INDUSTRIES</span>
    </div>
  );
}

export default HeaderBranding;

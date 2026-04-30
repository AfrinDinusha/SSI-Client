const catalyst = require("zcatalyst-sdk-node");

module.exports = async (context, basicIO) => {
  const catalystApp = catalyst.initialize(context);
  
  // Add a simple test to see if the function is being called
  console.log('Authorized portal function called');
  
  try {
    // Try to get user details using different methods
    let userDetails = null;
    
    // Method 1: Try getSignupValidationRequest
    try {
      const requestDetails = catalystApp
        .userManagement()
        .getSignupValidationRequest(basicIO);
      console.log('Method 1 - Request details received:', requestDetails);
      userDetails = requestDetails;
    } catch (error) {
      console.log('Method 1 failed:', error.message);
    }
    
    // Method 2: Try to get user from context
    if (!userDetails) {
      try {
        const user = context.user;
        console.log('Method 2 - Context user:', user);
        if (user) {
          userDetails = {
            user_details: {
              email_id: user.email,
              first_name: user.first_name || user.name?.split(' ')[0] || '',
              last_name: user.last_name || user.name?.split(' ').slice(1).join(' ') || '',
              user_id: user.user_id,
              org_id: user.org_id
            }
          };
        }
      } catch (error) {
        console.log('Method 2 failed:', error.message);
      }
    }
    
    // Method 3: Try to get from basicIO
    if (!userDetails) {
      try {
        const basicIOData = basicIO.getData();
        console.log('Method 3 - BasicIO data:', basicIOData);
        if (basicIOData) {
          userDetails = {
            user_details: {
              email_id: basicIOData.email || basicIOData.email_id,
              first_name: basicIOData.first_name || '',
              last_name: basicIOData.last_name || '',
              user_id: basicIOData.user_id,
              org_id: basicIOData.org_id
            }
          };
        }
      } catch (error) {
        console.log('Method 3 failed:', error.message);
      }
    }
    
    console.log('Final user details:', userDetails);
    
    if (userDetails) {
      const email = userDetails.user_details.email_id;
      
      // Check if user has valid domain or is a special contractor email
      // Exclude specific email that should be removed
      if (email === "afrindinusha.j@buildhr.co.in") {
        // This email is explicitly blocked
        basicIO.write(
          JSON.stringify({
            status: "failure",
            message: "Access denied for this email address."
          })
        );
        return;
      }
      
      if (email.includes("@buildhr.co.in") || email === "afrindinusha@gmail.com" || email === "rpdmanpowerservice@gmail.com" || email === "ramachandran23488@gmail.com" || email === "afrindinusha29@gmail.com" || email === "sriramenterprises50@yahoo.com" || email === "afrindinu29@gmail.com" || email === "afrindinu14@gmail.com" || email === "afrinatlin@gmail.com" || email === "samuelenterprisesms@gmail.com" || email === "dinushaafrin@gmail.com" || email === "vijaybalaji701@gmail.com" || email === "vaishnavi.a@buildhr.co.in" || email === "hr@sspower.com") {
        // Determine role based on email directly from authentication data
        let role = "App User"; // Default role
        
        // Define admin emails (you can easily add more)
        const adminEmails = [
          "afrindinusha@gmail.com", // Add afrindinusha@gmail.com as admin
          "rpdmanpowerservice@gmail.com", // Add rpdmanpowerservice@gmail.com as admin (same access as afrindinusha@gmail.com)
          "hr@sspower.com", // Add hr@sspower.com as admin
          // Add more admin emails here as needed
          // "admin2@buildhr.co.in",
          // "admin3@buildhr.co.in"
        ];
        
        // Assign admin role based on email
        if (adminEmails.includes(email)) {
          role = "App Administrator";
        }
        
        console.log(`Role detection for email: ${email} -> Role: ${role}`);
        
        // For App User role, check if the email matches any contractor's primary email
        let contractorInfo = null;
        if (role === "App User") {
          try {
            const zcql = catalystApp.zcql();
            const contractorQuery = await zcql.executeZCQLQuery(
              `SELECT ROWID, ContractorName, PrimaryEmail FROM Contractors WHERE PrimaryEmail = '${email}'`
            );
            
            if (contractorQuery && contractorQuery.length > 0) {
              contractorInfo = {
                contractorId: contractorQuery[0].Contractors.ROWID,
                contractorName: contractorQuery[0].Contractors.ContractorName,
                primaryEmail: contractorQuery[0].Contractors.PrimaryEmail
              };
              console.log(`Contractor found for email ${email}:`, contractorInfo);
            } else {
              console.log(`No contractor found for email ${email}`);
            }
          } catch (error) {
            console.log('Error checking contractor email:', error.message);
          }
        }
        
        // Return user details with role directly from authentication
        basicIO.write(
          JSON.stringify({
            status: "success",
            user_details: {
              first_name: userDetails.user_details.first_name,
              last_name: userDetails.user_details.last_name,
              email_id: userDetails.user_details.email_id,
              role_identifier: role,
              org_id: userDetails.user_details.org_id || "",
              user_id: userDetails.user_details.user_id || "",
              // Additional authentication info available
              auth_time: new Date().toISOString(),
              domain: email.split('@')[1] || "buildhr.co.in",
              // Include contractor info if user is a contractor
              contractor_info: contractorInfo
            },
          })
        );
      } else {
        // The user has failed authentication - wrong domain
        basicIO.write(
          JSON.stringify({
            status: "failure",
            message: "Invalid email domain. Only @buildhr.co.in emails or authorized contractor emails are allowed."
          })
        );
      }
    } else {
      // No request details found
      console.log('No request details found - user may not be authenticated');
      basicIO.write(
        JSON.stringify({
          status: "failure",
          message: "No authentication details found. Please ensure you are logged in."
        })
      );
    }
  } catch (error) {
    console.error('Error in authorized portal function:', error);
    basicIO.write(
      JSON.stringify({
        status: "failure",
        message: "Error processing authentication request."
      })
    );
  }
  
  context.close();
};
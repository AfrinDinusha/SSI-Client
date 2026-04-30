const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// GET API: Get all organizations (with optional pagination)
app.get('/organizations', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const zcql = catalyst.zcql();

        // Get total count for pagination
        const countRows = await zcql.executeZCQLQuery(`SELECT COUNT(ROWID) as count FROM Organization`);
        const total = parseInt(countRows[0].Organization.count);

        // Split columns into two queries to work around 30-column limit
        const columns1 = [
            'ROWID', 'OrganizationName', 'PrimaryName', 'RCNo', 'Designation', 'PrimaryContact', 'Landlinenumber',
            'SecondaryContact', 'Website', 'PrimaryEmail', 'SecondaryEmail', 'Noofcontractorsengaged', 'RegisteredContractManPower',
            'RegisteredAddressLine1', 'RegisteredAddressLine2', 'RegisteredCity', 'RegisteredState', 'RegisteredPostalCode',
            'RegisteredCountry', 'FactoryAddressLine', 'FactoryAddressLine2', 'FactoryCity', 'FactoryState', 'FactoryPostalCode', 'FactoryCountry',
            'AmendmentDate', 'AmendmentNo', 'NoofLicensedManpower', 'OurBankAccount', 'BC'
        ];
        
        const columns2 = [
            'ROWID', 'PrimaryContactPerson', 'SecondaryContactPerson', 'PrimaryContactPersonPhone', 'SecondaryContactPersonPhone',
            'PrimaryContactPersonEmail', 'SecondaryContactPersonmail'
        ];
        
        // Execute first query with main data
        const query1 = await zcql.executeZCQLQuery(
            `SELECT ${columns1.join(', ')} FROM Organization LIMIT ${(page - 1) * perPage + 1},${perPage}`
        );
        
        // Execute second query with contact person data
        const query2 = await zcql.executeZCQLQuery(
            `SELECT ${columns2.join(', ')} FROM Organization LIMIT ${(page - 1) * perPage + 1},${perPage}`
        );
        
        // Merge the results
        const query = query1.map((row1, index) => {
            const row2 = query2[index];
            return {
                Organization: {
                    ...row1.Organization,
                    ...row2.Organization
                }
            };
        });

        const organizations = query.map(row => {
            const org = row.Organization;
            return {
                id: org.ROWID,
                organizationName: org.OrganizationName,
                primaryName: org.PrimaryName,
                rcNo: org.RCNo,
                designation: org.Designation,
                primaryContact: org.PrimaryContact,
                landlineNumber: org.Landlinenumber,
                secondaryContact: org.SecondaryContact,
                website: org.Website,
                primaryEmail: org.PrimaryEmail,
                secondaryEmail: org.SecondaryEmail,
                noOfContractorsEngaged: org.Noofcontractorsengaged,
                registeredContractManPower: org.RegisteredContractManPower,
                registeredAddressLine1: org.RegisteredAddressLine1,
                registeredAddressLine2: org.RegisteredAddressLine2,
                registeredCity: org.RegisteredCity,
                registeredState: org.RegisteredState,
                registeredPostalCode: org.RegisteredPostalCode,
                registeredCountry: org.RegisteredCountry,
                factoryAddressLine: org.FactoryAddressLine,
                factoryAddressLine2: org.FactoryAddressLine2,
                factoryCity: org.FactoryCity,
                factoryState: org.FactoryState,
                factoryPostalCode: org.FactoryPostalCode,
                factoryCountry: org.FactoryCountry,
                postalCode: org.RegisteredPostalCode,  // Map to frontend field name
                country: org.RegisteredCountry,        // Map to frontend field name
                factoryAddressLine1: org.FactoryAddressLine,  // Map to frontend field name
                licenseAmendmentDate: org.AmendmentDate,  // Map to frontend field name
                amendmentNo: org.AmendmentNo,  // Map to frontend field name
                noOfLicensedManpower: org.NoofLicensedManpower,  // Map to frontend field name
                primaryContactPerson: org.PrimaryContactPerson,
                secondaryContactPerson: org.SecondaryContactPerson,
                primaryContactPersonPhone: org.PrimaryContactPersonPhone,
                secondaryContactPersonPhone: org.SecondaryContactPersonPhone,
                primaryContactPersonEmail: org.PrimaryContactPersonEmail,
                secondaryContactPersonEmail: org.SecondaryContactPersonmail,
                ourBankAccount: org.OurBankAccount,
                bc: org.BC
            };
        });

        res.status(200).send({
            status: 'success',
            data: {
                organizations,
                hasMore: page * perPage < total
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new organization (store all details)
app.post('/organizations', async (req, res) => {
    try {
        const { 
            organizationName, primaryContact, primaryEmail, primaryName, designation,
            landlineNumber, website, noOfContractorsEngaged, rcNo, secondaryContact,
            secondaryEmail, registeredContractManPower, registeredAddressLine1,
            registeredAddressLine2, registeredCity, registeredState, factoryAddressLine1,
            factoryAddressLine2, factoryCity, factoryState, sameAsRegisteredAddress,
            postalCode, country, licenseAmendmentDate, amendmentNo, registrationCertificate,
            noOfLicensedManpower,             primaryContactPerson, primaryContactPersonPhone,
            primaryContactPersonEmail, secondaryContactPerson, secondaryContactPersonPhone,
            secondaryContactPersonEmail, ourBankAccount, bc
        } = req.body;
        
        if (!organizationName || !primaryContact || !primaryEmail) {
            return res.status(400).send({
                status: 'failure',
                message: 'Organization Name, Primary Contact, and Primary Email are required.'
            });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Organization');
        
        // Store all fields that have data (not empty strings or null)
        const insertData = {};
        
        if (organizationName && organizationName.trim()) {
            insertData.OrganizationName = organizationName.trim();
        }
        if (primaryContact && primaryContact.trim()) {
            insertData.PrimaryContact = primaryContact.trim();
        }
        if (primaryEmail && primaryEmail.trim()) {
            insertData.PrimaryEmail = primaryEmail.trim();
        }
        if (primaryName && primaryName.trim()) {
            insertData.PrimaryName = primaryName.trim();
        }
        if (designation && designation.trim()) {
            insertData.Designation = designation.trim();
        }
        if (landlineNumber && landlineNumber.trim()) {
            insertData.Landlinenumber = landlineNumber.trim();
        }
        if (website && website.trim()) {
            insertData.Website = website.trim();
        }
        if (noOfContractorsEngaged && noOfContractorsEngaged.toString().trim() && !isNaN(noOfContractorsEngaged)) {
            insertData.Noofcontractorsengaged = parseInt(noOfContractorsEngaged);
        }
        if (rcNo && rcNo.trim()) {
            insertData.RCNo = rcNo.trim();
        }
        if (secondaryContact && secondaryContact.trim()) {
            insertData.SecondaryContact = secondaryContact.trim();
        }
        if (secondaryEmail && secondaryEmail.trim()) {
            insertData.SecondaryEmail = secondaryEmail.trim();
        }
        if (registeredContractManPower && registeredContractManPower.toString().trim() && !isNaN(registeredContractManPower)) {
            insertData.RegisteredContractManPower = parseInt(registeredContractManPower);
        }
        if (registeredAddressLine1 && registeredAddressLine1.trim()) {
            insertData.RegisteredAddressLine1 = registeredAddressLine1.trim();
        }
        if (registeredAddressLine2 && registeredAddressLine2.trim()) {
            insertData.RegisteredAddressLine2 = registeredAddressLine2.trim();
        }
        if (registeredCity && registeredCity.trim()) {
            insertData.RegisteredCity = registeredCity.trim();
        }
        if (registeredState && registeredState.trim()) {
            insertData.RegisteredState = registeredState.trim();
        }
        if (postalCode && postalCode.trim()) {
            insertData.RegisteredPostalCode = postalCode.trim();
        }
        if (country && country.trim()) {
            insertData.RegisteredCountry = country.trim();
        }
        if (factoryAddressLine1 && factoryAddressLine1.trim()) {
            insertData.FactoryAddressLine = factoryAddressLine1.trim();
        }
        if (factoryAddressLine2 && factoryAddressLine2.trim()) {
            insertData.FactoryAddressLine2 = factoryAddressLine2.trim();
        }
        if (factoryCity && factoryCity.trim()) {
            insertData.FactoryCity = factoryCity.trim();
        }
        if (factoryState && factoryState.trim()) {
            insertData.FactoryState = factoryState.trim();
        }
        if (licenseAmendmentDate && licenseAmendmentDate.trim()) {
            insertData.AmendmentDate = licenseAmendmentDate.trim();
        }
        if (amendmentNo && amendmentNo.trim()) {
            insertData.AmendmentNo = amendmentNo.trim();
        }
        if (noOfLicensedManpower && noOfLicensedManpower.toString().trim() && !isNaN(noOfLicensedManpower)) {
            insertData.NoofLicensedManpower = parseInt(noOfLicensedManpower);
        }
        if (primaryContactPerson && primaryContactPerson.trim()) {
            insertData.PrimaryContactPerson = primaryContactPerson.trim();
        }
        if (primaryContactPersonPhone && primaryContactPersonPhone.trim()) {
            insertData.PrimaryContactPersonPhone = primaryContactPersonPhone.trim();
        }
        if (primaryContactPersonEmail && primaryContactPersonEmail.trim()) {
            insertData.PrimaryContactPersonEmail = primaryContactPersonEmail.trim();
        }
        if (secondaryContactPerson && secondaryContactPerson.trim()) {
            insertData.SecondaryContactPerson = secondaryContactPerson.trim();
        }
        if (secondaryContactPersonPhone && secondaryContactPersonPhone.trim()) {
            insertData.SecondaryContactPersonPhone = secondaryContactPersonPhone.trim();
        }
        if (secondaryContactPersonEmail && secondaryContactPersonEmail.trim()) {
            insertData.SecondaryContactPersonmail = secondaryContactPersonEmail.trim();
        }
        if (ourBankAccount && ourBankAccount.trim()) {
            insertData.OurBankAccount = ourBankAccount.trim();
        }
        if (bc && String(bc).trim()) {
            insertData.BC = String(bc).trim();
        }
        
        const { ROWID: id } = await table.insertRow(insertData);
        
        res.status(200).send({
            status: 'success',
            data: { 
                organization: { 
                    id, 
                    ...insertData 
                } 
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// PUT API: Update an organization by ROWID (store all details)
app.put('/organizations/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { 
            organizationName, primaryContact, primaryEmail, primaryName, designation,
            landlineNumber, website, noOfContractorsEngaged, rcNo, secondaryContact,
            secondaryEmail, registeredContractManPower, registeredAddressLine1,
            registeredAddressLine2, registeredCity, registeredState, factoryAddressLine1,
            factoryAddressLine2, factoryCity, factoryState, sameAsRegisteredAddress,
            postalCode, country, licenseAmendmentDate, amendmentNo, registrationCertificate,
            noOfLicensedManpower,             primaryContactPerson, primaryContactPersonPhone,
            primaryContactPersonEmail, secondaryContactPerson, secondaryContactPersonPhone,
            secondaryContactPersonEmail, ourBankAccount, bc
        } = req.body;
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Organization');
        
        // Update all fields that have data (not empty strings or null)
        const updateData = { ROWID };
        
        if (organizationName && organizationName.trim()) {
            updateData.OrganizationName = organizationName.trim();
        }
        if (primaryContact && primaryContact.trim()) {
            updateData.PrimaryContact = primaryContact.trim();
        }
        if (primaryEmail && primaryEmail.trim()) {
            updateData.PrimaryEmail = primaryEmail.trim();
        }
        if (primaryName && primaryName.trim()) {
            updateData.PrimaryName = primaryName.trim();
        }
        if (designation && designation.trim()) {
            updateData.Designation = designation.trim();
        }
        if (landlineNumber && landlineNumber.trim()) {
            updateData.Landlinenumber = landlineNumber.trim();
        }
        if (website && website.trim()) {
            updateData.Website = website.trim();
        }
        if (noOfContractorsEngaged && noOfContractorsEngaged.toString().trim() && !isNaN(noOfContractorsEngaged)) {
            updateData.Noofcontractorsengaged = parseInt(noOfContractorsEngaged);
        }
        if (rcNo && rcNo.trim()) {
            updateData.RCNo = rcNo.trim();
        }
        if (secondaryContact && secondaryContact.trim()) {
            updateData.SecondaryContact = secondaryContact.trim();
        }
        if (secondaryEmail && secondaryEmail.trim()) {
            updateData.SecondaryEmail = secondaryEmail.trim();
        }
        if (registeredContractManPower && registeredContractManPower.toString().trim() && !isNaN(registeredContractManPower)) {
            updateData.RegisteredContractManPower = parseInt(registeredContractManPower);
        }
        if (registeredAddressLine1 && registeredAddressLine1.trim()) {
            updateData.RegisteredAddressLine1 = registeredAddressLine1.trim();
        }
        if (registeredAddressLine2 && registeredAddressLine2.trim()) {
            updateData.RegisteredAddressLine2 = registeredAddressLine2.trim();
        }
        if (registeredCity && registeredCity.trim()) {
            updateData.RegisteredCity = registeredCity.trim();
        }
        if (registeredState && registeredState.trim()) {
            updateData.RegisteredState = registeredState.trim();
        }
        if (factoryAddressLine1 && factoryAddressLine1.trim()) {
            updateData.FactoryAddressLine = factoryAddressLine1.trim();
        }
        if (factoryAddressLine2 && factoryAddressLine2.trim()) {
            updateData.FactoryAddressLine2 = factoryAddressLine2.trim();
        }
        if (factoryCity && factoryCity.trim()) {
            updateData.FactoryCity = factoryCity.trim();
        }
        if (factoryState && factoryState.trim()) {
            updateData.FactoryState = factoryState.trim();
        }
        if (postalCode && postalCode.trim()) {
            updateData.RegisteredPostalCode = postalCode.trim();
        }
        if (country && country.trim()) {
            updateData.RegisteredCountry = country.trim();
        }
        if (licenseAmendmentDate && licenseAmendmentDate.trim()) {
            updateData.AmendmentDate = licenseAmendmentDate.trim();
        }
        if (amendmentNo && amendmentNo.trim()) {
            updateData.AmendmentNo = amendmentNo.trim();
        }
        if (noOfLicensedManpower && noOfLicensedManpower.toString().trim() && !isNaN(noOfLicensedManpower)) {
            updateData.NoofLicensedManpower = parseInt(noOfLicensedManpower);
        }
        if (primaryContactPerson && primaryContactPerson.trim()) {
            updateData.PrimaryContactPerson = primaryContactPerson.trim();
        }
        if (primaryContactPersonPhone && primaryContactPersonPhone.trim()) {
            updateData.PrimaryContactPersonPhone = primaryContactPersonPhone.trim();
        }
        if (primaryContactPersonEmail && primaryContactPersonEmail.trim()) {
            updateData.PrimaryContactPersonEmail = primaryContactPersonEmail.trim();
        }
        if (secondaryContactPerson && secondaryContactPerson.trim()) {
            updateData.SecondaryContactPerson = secondaryContactPerson.trim();
        }
        if (secondaryContactPersonPhone && secondaryContactPersonPhone.trim()) {
            updateData.SecondaryContactPersonPhone = secondaryContactPersonPhone.trim();
        }
        if (secondaryContactPersonEmail && secondaryContactPersonEmail.trim()) {
            updateData.SecondaryContactPersonmail = secondaryContactPersonEmail.trim();
        }
        if (ourBankAccount && ourBankAccount.trim()) {
            updateData.OurBankAccount = ourBankAccount.trim();
        }
        if (bc && String(bc).trim()) {
            updateData.BC = String(bc).trim();
        }
        
        // Only proceed if we have at least one field to update
        if (Object.keys(updateData).length === 1) { // Only ROWID
            return res.status(400).send({
                status: 'failure',
                message: 'At least one field must have data to update.'
            });
        }
        
        const updatedRow = await table.updateRow(updateData);
        
        res.status(200).send({
            status: 'success',
            data: {
                organization: {
                    id: updatedRow.ROWID,
                    ...updateData
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// DELETE API: Delete an organization by ROWID
app.delete('/organizations/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Organization');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: {
                organization: {
                    id: ROWID
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

module.exports = app;
// The privacy policy and cookie notice. DRAFT for review by a solicitor before publication.
// Changing the text means a new PRIVACY_VERSION.
export const PRIVACY_VERSION = '2026-11-tm-draft-1';

export function privacyHtml(env) {
  const A = env.PROVIDER_ADDRESS || '[Registered office address]';
  const S = env.APP_NAME || 'TM WerX',
    E = env.SUPPORT_EMAIL || 'support@tmwerx.co.uk';
  return `
<p class="draft">DRAFT FOR LEGAL REVIEW — not yet approved for publication.</p>
<h2>${S} — Privacy Policy and Cookie Notice</h2>
<p>Version ${PRIVACY_VERSION}.</p>
<h2 id="privacy-policy">Privacy policy</h2>
<h2 id="who-we-are">1. Who we are</h2>
<p>CAD WerX Limited (“we”) runs TM WerX, a job, crew and site-record service for traffic management companies, at tmwerx.co.uk. We are a company registered in England and Wales, number ${env.PROVIDER_NUMBER || '[company number]'}, registered office ${A}. We are registered with the Information Commissioner’s Office, number ${env.PROVIDER_ICO || '[ICO number]'}.</p>
<p>For anything about your personal data, email ${E} or write to us at the registered office.</p>
<h2 id="who-this-policy-covers">2. Who this policy covers</h2>
<p>This policy covers office users and crew members who use TM WerX for a customer company, people invited to join a customer’s account, billing contacts, and visitors to tmwerx.co.uk. TM WerX is a business service and is not for anyone under 18.</p>
<p><strong>If you are a crew member or office user:</strong> your employer (our customer) decides how TM WerX is used for its jobs and is the controller of the job records, including your checks, signatures, photos, positions and working times. We process those for your employer, under our agreement with them. Ask your employer about how they use that information; we will pass any request you send us to them. Section 3A describes what the service records.</p>
<h2 id="what-we-collect">3. What we collect</h2>
<ul>
<li><strong>Account details:</strong> your name, work email address, company name and role in the account. Your password is stored only as a secure hash; we can’t read it.</li>
<li><strong>Sign-in and security records:</strong> IP address, browser type, sign-in times, failed sign-in attempts, one-use email links and sign-in codes, and a random identifier for each browser you have confirmed with a code.</li>
<li><strong>Requests to join your organisation:</strong> if you try to sign up with an email domain that already has a TM WerX organisation, we email that organisation’s administrators your name and email address so they can invite you. We don’t keep the request.</li>
<li><strong>Agreement records:</strong> who accepted the customer agreement, which version, when, and from which IP address and browser.</li>
<li><strong>Billing details:</strong> the billing contact, company address, VAT number if given, subscription status and number of users. Stripe takes card details directly. We never see or store full card numbers.</li>
<li><strong>Company settings:</strong> the company logo.</li>
<li><strong>Support messages and demo requests:</strong> anything you send us by email or through the contact form on tmwerx.co.uk (your name, company, email, phone number if given, and your message). Form messages are emailed to us and not stored on the website.</li>
</ul>
<h2 id="job-records">3A. Job records (processed for your employer)</h2>
<ul>
<li><strong>Crew logins:</strong> name, username, mobile number if given, role, day cost if your employer enters it, and qualifications or cards with their expiry dates.</li>
<li><strong>Records from site:</strong> each check, sign-off, note and report you send, with the time on your phone and the time it arrived. Signatures you draw for RAMS, vehicle checks and finishing a visit.</li>
<li><strong>Position:</strong> your phone’s position when you sign in on site, sign out and make most records, and when you raise a panic alarm. While you are signed in to a visit and the app is open, your latest position is sent about every 5 minutes so the office can see where crews are; only the latest position is kept, and it is deleted after 2 hours. Your position is not tracked outside working time.</li>
<li><strong>Photos:</strong> photos you take in the app, with their time and position and a fingerprint. Photos may show other people or vehicles at the site.</li>
<li><strong>Working time and safety:</strong> sign-in and sign-out times used for timesheets, lone-working check-ins, near misses and panic alarms.</li>
<li><strong>The phone:</strong> whether the app is on the home screen, and, if you allow notifications, a notification address for your phone from its push service.</li>
<li><strong>Jobs and requests:</strong> names and contact details of clients and site contacts in jobs, and emails or messages forwarded to the company’s job request address.</li>
</ul>
<p>Completed jobs are kept for the period your employer sets (6 years unless changed), then deleted with their photos.</p>
<h2 id="why-we-use-it-and-our-lawful-basis">4. Why we use it and our lawful basis</h2>
<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th>What we do</th>
<th>Lawful basis under UK GDPR</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Create and run accounts, sign users in, send account emails</td>
<td>Contract with the customer company, and our legitimate interest in providing the service to its users</td>
</tr>
<tr class="even">
<td>Take payment and manage subscriptions</td>
<td>Contract</td>
</tr>
<tr class="odd">
<td>Keep the service secure, limit sign-in attempts, prevent fraud</td>
<td>Legitimate interests</td>
</tr>
<tr class="even">
<td>Keep records of agreement acceptance and invoices</td>
<td>Legal obligation, and legitimate interests in defending legal claims</td>
</tr>
<tr class="odd">
<td>Answer support requests</td>
<td>Legitimate interests</td>
</tr>
<tr class="even">
<td>Tell business users about changes to the service</td>
<td>Legitimate interests (you can opt out of anything that isn’t a service message)</td>
</tr>
</tbody>
</table>
<p>We don’t sell personal data and don’t use it for advertising. We make no decisions about you by automated means that have legal or similarly significant effects.</p>
<h2 id="who-we-share-it-with">5. Who we share it with</h2>
<p>We use these service providers, who act on our instructions under data processing terms:</p>
<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th>Provider</th>
<th>What they do</th>
<th>Where</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Cloudflare, Inc.</td>
<td>Hosting, database, file storage, security</td>
<td>Global network; data stored in Western Europe</td>
</tr>
<tr class="even">
<td>Stripe Payments Europe Ltd and Stripe, Inc.</td>
<td>Payments and subscriptions</td>
<td>UK, EU and US</td>
</tr>
<tr class="odd">
<td>Resend, Inc.</td>
<td>Sending account emails and alerts to office users</td>
<td>US</td>
</tr>
<tr class="even">
<td>Apple, Google and Mozilla push services</td>
<td>Delivering encrypted notifications to phones</td>
<td>US and elsewhere</td>
</tr>
</tbody>
</table>
<p>Stripe also uses payment data as an independent controller for fraud prevention and its own legal duties, under its own privacy policy.</p>
<p>When an office user adds a job, our servers send its postcode (and nothing about you) to <strong>postcodes.io</strong> to find its position.</p>
<p>Notifications to phones are sent through the phone maker’s push service (Apple, Google or Mozilla). The message is encrypted on our servers so the push service cannot read it.</p>
<p>An office user can make a link to a job’s record for their client. Anyone with the link can see the job’s records and photos until it expires.</p>
<p>We may also share data with our professional advisers, or where the law requires it.</p>
<h2 id="international-transfers">6. International transfers</h2>
<p>Some providers process data in the United States. Where they do, we rely on the UK–US data bridge for providers certified under it, or the UK International Data Transfer Addendum to the EU Standard Contractual Clauses.</p>
<h2 id="how-long-we-keep-it">7. How long we keep it</h2>
<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th>Data</th>
<th>Kept for</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Sign-ups never confirmed</td>
<td>48 hours</td>
</tr>
<tr class="even">
<td>Failed sign-in attempt records</td>
<td>1 day</td>
</tr>
<tr class="odd">
<td>Signed-in sessions</td>
<td>Up to 30 days, or until you sign out or sign in on another device</td>
</tr>
<tr class="even">
<td>Sign-in codes</td>
<td>15 minutes</td>
</tr>
<tr class="odd">
<td>Confirmed browsers</td>
<td>Until the browser hasn’t been used to sign in for 400 days</td>
</tr>
<tr class="even">
<td>Email links</td>
<td>Until used or expired, then deleted within the hour</td>
</tr>
<tr class="odd">
<td>Company logo</td>
<td>Deleted as soon as the account is closed</td>
</tr>
<tr class="even">
<td>Account and user details</td>
<td>Until 90 days after the account is closed</td>
</tr>
<tr class="odd">
<td>Agreement acceptances, invoices and billing records</td>
<td>6 years after the account is closed</td>
</tr>
<tr class="odd">
<td>Job records, photos and drawings</td>
<td>The period the customer sets after the job is completed (6 years unless changed), or 90 days after the account closes</td>
</tr>
<tr class="even">
<td>Crew positions while signed in</td>
<td>Only the latest one, deleted after 2 hours</td>
</tr>
<tr class="odd">
<td>Job requests (forwarded emails and messages)</td>
<td>Until the customer deletes the account; rejected requests 90 days</td>
</tr>
<tr class="odd">
<td>Encrypted weekly backups of the account data and logos</td>
<td>8 weeks, so anything deleted is gone from the backups within 8 weeks</td>
</tr>
<tr class="odd">
<td>Support emails and demo requests</td>
<td>2 years after the last message</td>
</tr>
</tbody>
</table>
<h2 id="your-rights">8. Your rights</h2>
<p>You can ask us to give you a copy of your data, correct it, delete it, restrict how we use it, or move it to another provider. You can object to any use based on legitimate interests. Email ${E} and we’ll reply within one month.</p>
<p>An account administrator can also download the company’s data or close the account from the account page.</p>
<h2 id="security">9. Security</h2>
<p>We use encrypted connections throughout, hash passwords, limit sign-in attempts and keep each company’s data separate, and restrict who in our company can access customer data.</p>
<h2 id="complaints">10. Complaints</h2>
<p>If you’re unhappy with how we’ve handled your data, please tell us first at ${E} and we’ll look into it. You can also complain to the Information Commissioner’s Office at ico.org.uk or on 0303 123 1113.</p>
<h2 id="changes">11. Changes</h2>
<p>We’ll post any update here with a new version number and date. If a change materially affects how we use your data, we’ll email account administrators first.</p>
<h2 id="cookie-notice">Cookie notice</h2>
<p>TM WerX uses only cookies and browser storage that the service needs to work. We don’t use analytics, advertising or tracking cookies, so we don’t ask for cookie consent.</p>
<h2 id="cookies-we-set">Cookies we set</h2>
<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th>Name</th>
<th>Purpose</th>
<th>How long</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>__Host-tm_s</td>
<td>Keeps you signed in. Secure and not readable by scripts.</td>
<td>Up to 30 days, or until you sign out</td>
</tr>
<tr class="even">
<td>__Host-tm_d</td>
<td>Remembers that you’ve confirmed this browser with an emailed code, so you’re only asked once on each browser. A random identifier, secure and not readable by scripts.</td>
<td>400 days</td>
</tr>
<tr class="odd">
<td>__Host-tm_p</td>
<td>Holds a sign-in open while you enter the emailed code.</td>
<td>15 minutes</td>
</tr>
</tbody>
</table>
<h2 id="cookies-set-by-our-providers">Cookies set by our providers</h2>
<table>
<colgroup>
<col style="width: 25%" />
<col style="width: 25%" />
<col style="width: 25%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr class="header">
<th>Name</th>
<th>Set by</th>
<th>Purpose</th>
<th>How long</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>__cf_bm</td>
<td>Cloudflare</td>
<td>Tells people apart from automated traffic, to protect the site</td>
<td>30 minutes</td>
</tr>
<tr class="even">
<td>Payment cookies</td>
<td>Stripe, on its own checkout pages</td>
<td>Processing payments and preventing fraud</td>
<td>Set out in Stripe’s cookie policy (stripe.com/cookies-policy/legal)</td>
</tr>
</tbody>
</table>
<h2 id="browser-storage">Browser storage</h2>
<p>The crew app keeps your jobs, drawings, documents and any records and photos not yet sent in the phone’s storage, so it works without signal. They stay on the phone until they are sent, and the saved jobs are removed when you sign out. The office app may remember simple screen settings in your browser.</p>
<h2 id="fonts">Fonts</h2>
<p>We serve our own fonts, so no font provider receives your visit.</p>
<h2 id="managing-cookies">Managing cookies</h2>
<p>You can block or delete cookies in your browser settings. If you block the sign-in cookie, you won’t be able to sign in.</p>
<h2 id="changes-1">Changes</h2>
<p>If we ever add cookies that aren’t strictly necessary, we’ll update this notice and ask for your consent before setting them.</p>
<p>Questions: ${E}</p>
`;
}

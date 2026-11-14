// The customer agreement. DRAFT for review by a solicitor before any customer signs it.
// Changing the text means a new TERMS_VERSION: every user is asked to accept the new version at their next sign-in.
export const TERMS_VERSION = '2026-11-tm-draft-2';

export function termsHtml(env) {
  const A = env.PROVIDER_ADDRESS || '[Registered office address]';
  const S = env.APP_NAME || 'TM WerX',
    E = env.SUPPORT_EMAIL || 'support@tmwerx.co.uk';
  return `
<p class="draft">DRAFT FOR LEGAL REVIEW — not yet approved for use with customers.</p>
<h2>${S} — Customer Agreement</h2>
<p>Version ${TERMS_VERSION}.</p>
<h3 id="about">1. About this agreement</h3>
<p>1.1 This agreement is between <strong>${env.PROVIDER_NAME || 'Hades WerX Limited'}</strong>, a company registered in England and Wales with number ${env.PROVIDER_NUMBER || '[company number]'} and registered office at ${A} (“<strong>we</strong>”, “<strong>us</strong>”), and the organisation named when the account was opened (the “<strong>Customer</strong>”, “<strong>you</strong>”).</p>
<p>1.2 The person who opens the account accepts this agreement on the Customer’s behalf and confirms they are authorised to do so. Each office user also accepts it before using the Service.</p>
<p>1.3 The Service is for businesses only. It is not offered to consumers.</p>
<h3 id="service">2. The Service</h3>
<p>2.1 ${S} (“<strong>the Service</strong>”) is web software for traffic management companies. Office users plan jobs and visits, allocate crews, vehicles and drawings, and review site records. Crew members use a web app on their phones to receive jobs, complete checks and sign-offs, take photos and send records from site.</p>
<p>2.2 The crew app is installed from a web link to the phone’s home screen. It keeps jobs, drawings and documents on the phone so it can be used without signal, and sends records and photos when signal is available. Records made without signal are not seen by the office until they are sent.</p>
<p>2.3 The Service can link to a CAD WerX account so that issued CAD WerX drawings can be added to jobs. CAD WerX is a separate service under its own agreement.</p>
<h3 id="responsibilities">3. Your responsibilities</h3>
<p>3.1 <strong>You remain responsible for your work.</strong> You are responsible for planning, designing, installing, maintaining and removing traffic management, for the competence and supervision of your people, for your risk assessments and method statements, and for complying with the <em>Safety at Street Works and Road Works</em> Code of Practice, permits and the law.</p>
<p>3.2 <strong>Starter documents.</strong> The Service includes example risk assessment, method statement, vehicle check and hazard wording to help you start. It is marked DRAFT until one of your administrators approves your own version. You must review and adapt it to your work and each site before relying on it.</p>
<p>3.3 <strong>Not an emergency service.</strong> Lone-working check-ins, the panic alarm, notifications and alerts depend on phones, signal, power and third-party notification services, and may be delayed or fail. They support, and do not replace, your own emergency and lone-working arrangements. In an emergency your people must call 999.</p>
<p>3.4 <strong>Information from the Service.</strong> Details read from job requests, postcode positions, timesheets and cost figures are worked out automatically and may be wrong. Check them before relying on them, for example for pay or invoices.</p>
<p>3.5 <strong>Your workers.</strong> You must tell your workers how their information is used in the Service, including their position when they sign in, sign out and raise an alarm, their latest position while signed in to a visit, their photos, signatures and working times, and have a lawful basis for that use (see clause 12 and the Schedule).</p>
<h3 id="accounts">4. Accounts and users</h3>
<p>4.1 Each person must have their own login. Logins must not be shared. You are responsible for all activity under your account.</p>
<p>4.2 Office users are invited by email. Crew logins are made by your office users, who give the crew member their username and password. You must switch off the login of anyone who leaves.</p>
<p>4.3 Keep login details secure and tell us straight away at ${E} if you suspect an account has been compromised.</p>
<h3 id="fees">5. Subscription and fees</h3>
<p>5.1 The Service is charged per active user (office users and crew logins) per month at the price shown when you subscribe, plus VAT where applicable. Payment is taken in advance through our payment provider, Stripe.</p>
<p>5.2 Adding a user is charged straight away for the rest of the billing period. Switching a user off gives a credit against your next invoice.</p>
<p>5.3 The subscription renews monthly until cancelled. You can cancel at any time from your account page, and cancellation takes effect at the end of the paid period. Fees already paid are not refunded, except as the law requires.</p>
<p>5.4 If a payment fails, we will tell you and retry. If it is still unpaid 14 days after the due date, we may suspend access until it is paid. Records already on crew phones are kept on the phone and sent once access returns.</p>
<p>5.5 We may change our prices by giving at least 30 days’ notice. The change applies from your next billing period after the notice ends.</p>
<h3 id="content">6. Your content</h3>
<p>6.1 You own the content you and your users put into the Service: jobs, drawings, documents, records, signatures and photos (“<strong>Your Content</strong>”).</p>
<p>6.2 You give us a licence to store and process Your Content only to provide, support and secure the Service.</p>
<p>6.3 Records sent from site are kept as they were sent and cannot be edited. Office users can add notes and corrections, which are kept alongside them.</p>
<p>6.4 <strong>Sharing with your clients.</strong> An office user can make a link that lets anyone who has it view a job’s record, drawings and photos until it expires or is switched off. You are responsible for who you send links to.</p>
<p>6.5 <strong>Keeping records.</strong> Completed jobs are deleted, with their photos and drawings, after the period set by your administrator (6 years unless changed). You can download any job, or all your data, at any time. Keep your own copies of anything you need to keep for longer.</p>
<p>6.6 You confirm you have the right to upload Your Content, including drawings and logos, and that it does not infringe anyone else’s rights.</p>
<h3 id="ip">7. Our intellectual property</h3>
<p>7.1 We and our licensors own the Service and all rights in it. You may use it only for your own business during your subscription.</p>
<p>7.2 You must not copy, resell, reverse engineer or attempt to obtain the source code of the Service, or use it to build a competing product, except as the law permits.</p>
<h3 id="use">8. Acceptable use</h3>
<p>8.1 You must not: (a) use the Service unlawfully or to monitor people beyond what clause 3.5 describes; (b) try to gain unauthorised access to the Service or interfere with it; (c) use automated means to extract data from it, other than the downloads it provides; or (d) let anyone outside your organisation use your account, other than viewing a share link under clause 6.4.</p>
<h3 id="availability">9. Availability and changes</h3>
<p>9.1 We will use reasonable care and skill to provide the Service and aim to keep it available. We do not promise it will be uninterrupted or error-free.</p>
<p>9.2 We may carry out maintenance and improve or change features. We will not materially reduce the core functionality during a paid period without notice.</p>
<h3 id="third-parties">10. Third-party services</h3>
<p>10.1 Postcode positions come from postcodes.io, which uses Ordnance Survey, Royal Mail and Office for National Statistics open data. Notifications to phones are delivered by the phone maker’s push service (for example Apple or Google). We are not responsible for those services.</p>
<h3 id="confidentiality">11. Confidentiality</h3>
<p>11.1 Each party will keep the other’s confidential information confidential and use it only for this agreement, except where disclosure is required by law.</p>
<h3 id="data">12. Data protection</h3>
<p>12.1 Each party will comply with UK data protection law, including the UK GDPR and the Data Protection Act 2018.</p>
<p>12.2 You are the controller of the personal data in Your Content, including your workers’ information. We process it for you as processor under the Data Processing Schedule below.</p>
<p>12.3 We are controller for account, billing and security data, as our privacy policy describes.</p>
<h3 id="liability">13. Liability</h3>
<p>13.1 Nothing in this agreement limits or excludes liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot be limited or excluded by law.</p>
<p>13.2 To the extent the law allows, all terms implied by statute or common law are excluded.</p>
<p>13.3 Subject to clause 13.1, we are not liable for any: (a) loss of profit, revenue, business, contracts or goodwill; (b) indirect or consequential loss; or (c) loss arising from a record, alert, notification or alarm that was delayed or not delivered because of a phone, signal, power or third-party service.</p>
<p>13.4 Subject to clause 13.1, our total liability under or in connection with this agreement is limited to the greater of: (a) the fees you paid in the 12 months before the event giving rise to the claim; and (b) £[X].</p>
<h3 id="indemnity">14. Indemnity</h3>
<p>14.1 You will indemnify us against claims, losses and costs arising from: (a) your misuse of the Service; (b) Your Content; and (c) your failure to meet clause 3.5.</p>
<h3 id="termination">15. Suspension and termination</h3>
<p>15.1 Either party may end this agreement by cancelling the subscription. Cancellation takes effect at the end of the paid period.</p>
<p>15.2 Either party may end this agreement immediately by notice if the other: (a) materially breaches it and does not put the breach right within 14 days of being asked to; or (b) becomes insolvent.</p>
<p>15.3 We may suspend access for non-payment or misuse.</p>
<p>15.4 You can download your data during the term and for 30 days after it ends.</p>
<p>15.5 We will delete Your Content 90 days after the agreement ends. We keep records we must keep, such as acceptances of this agreement and invoices, for 6 years.</p>
<h3 id="force-majeure">16. Force majeure</h3>
<p>16.1 Neither party is liable for delay or failure caused by events beyond its reasonable control, including the failure of a hosting, payment, email or push notification provider, or of mobile networks.</p>
<h3 id="changes">17. Changes to this agreement</h3>
<p>17.1 We may change this agreement by giving at least 30 days’ notice by email to your account administrator. If you do not accept a change, you may cancel before it takes effect, and we will refund any fees paid for the period after the change. Changes required by law may take effect sooner.</p>
<h3 id="notices">18. Notices</h3>
<p>18.1 We will send notices to your account administrator’s email address. You can send notices to ${E}.</p>
<h3 id="general">19. General</h3>
<p>19.1 This agreement is the whole agreement between us about the Service. Neither party may transfer it without the other’s consent, except that we may transfer it to a successor of our business. No one else has rights under it.</p>
<p>19.2 This agreement is governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.</p>
<h3 id="schedule">Schedule: Data Processing</h3>
<p>S1 <strong>Instructions.</strong> We process personal data for you only on your documented instructions, which are to provide the Service under this agreement.</p>
<p>S2 <strong>What is processed.</strong> About your office users and crew: names, work email addresses (office users), usernames, mobile numbers, day costs, qualifications and card expiry dates, signatures, sign-in and sign-out times and positions, position when a panic alarm is raised, the latest position while signed in to a visit (not a history), lone-working check-ins, photos they take, vehicle checks, near-miss reports and notes. About others: names and contact details in jobs and job requests, and people or vehicles that appear in site photos. Processing lasts while this agreement runs and then as clause 15 sets out.</p>
<p>S3 <strong>Confidentiality.</strong> We ensure everyone who processes the data is bound by confidentiality.</p>
<p>S4 <strong>Security.</strong> We keep appropriate technical and organisational measures in place, including encryption in transit, hashed passwords, per-company separation of data, end-to-end encrypted notification messages, fingerprints (SHA-256) on stored files, and encrypted backups.</p>
<p>S5 <strong>Sub-processors.</strong> You authorise the sub-processors below. We will give you at least 30 days’ notice of any new sub-processor, and you may object.</p>
<table><thead><tr><th>Sub-processor</th><th>Purpose</th></tr></thead><tbody>
<tr><td>Cloudflare, Inc.</td><td>Hosting, database, file storage and email receiving</td></tr>
<tr><td>Stripe Payments Europe Ltd / Stripe, Inc.</td><td>Payments (account contact details only)</td></tr>
<tr><td>Resend, Inc.</td><td>Emails to office users</td></tr>
<tr><td>Apple, Google and Mozilla push services</td><td>Delivering notifications to phones (the message content is encrypted so they cannot read it)</td></tr>
<tr><td>postcodes.io</td><td>Postcode lookup (postcode text only)</td></tr>
</tbody></table>
<p>S6 <strong>Transfers.</strong> Where data is processed outside the UK, we rely on UK adequacy regulations or the UK International Data Transfer Addendum.</p>
<p>S7 <strong>Assistance.</strong> We will help you respond to data subject requests and meet your security, breach notification and impact assessment obligations, as far as reasonable.</p>
<p>S8 <strong>Breaches.</strong> We will tell you without undue delay after becoming aware of a personal data breach affecting your data.</p>
<p>S9 <strong>End of processing.</strong> At the end of the agreement we will delete or return the data, as clause 15 sets out.</p>
<p>S10 <strong>Audit.</strong> We will make available the information reasonably needed to show compliance with this Schedule.</p>
`;
}

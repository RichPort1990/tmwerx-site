// The public home page for TM WerX: hero, what it does in the office and on site, pricing, get in touch
import { esc } from './pages.js';
import { FONT_CSS } from './fonts.js';
import { companyLine, priceGbp, vatNote } from './lib/core.js';

const CSS =
  FONT_CSS +
  `
:root{--bg:#121518;--s1:#1a1e23;--s2:#22272d;--s3:#2b3138;--line:#333a42;--text:#eceef0;--soft:#c3c8ce;--muted:#949ba4;
--or:#f26b1d;--or-dk:#c4520f;--or-lt:#ff8a45;--display:'Barlow Condensed','Arial Narrow',Arial,sans-serif;--body:'Barlow',Arial,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.6 var(--body);-webkit-font-smoothing:antialiased}
a{color:inherit}img{max-width:100%;height:auto;display:block}
:focus-visible{outline:3px solid var(--or);outline-offset:2px}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.mark{font:800 26px/1 var(--body);letter-spacing:-.5px;text-decoration:none;color:#fff;white-space:nowrap}.mark span{color:var(--or);font-weight:900}
.btn{display:inline-flex;align-items:center;justify-content:center;font:600 16px/1 var(--body);padding:13px 20px;border-radius:999px;text-decoration:none;border:2px solid transparent;cursor:pointer;white-space:nowrap}
.btn-or{background:var(--or);color:#fff}.btn-or:hover{background:var(--or-lt)}
.btn-ghost{border-color:rgba(255,255,255,.55);color:#fff}.btn-ghost:hover{border-color:#fff;background:rgba(255,255,255,.08)}
/* header: a solid bar that stays at the top, with an orange rule under it */
.top{position:sticky;top:0;z-index:10;background:rgba(18,21,24,.94);backdrop-filter:saturate(1.4) blur(8px);-webkit-backdrop-filter:saturate(1.4) blur(8px);border-bottom:2px solid var(--or)}
.top .wrap{display:flex;align-items:center;gap:28px;height:70px}
.top nav{display:flex;gap:24px;font-weight:600;font-size:16px}.top nav a{color:var(--soft);text-decoration:none}.top nav a:hover{color:#fff}
.top .acts{margin-left:auto;display:flex;align-items:center;gap:12px}
.top .acts .lnk{color:var(--soft);font-weight:600;font-size:15px;text-decoration:none;padding:8px 4px}.top .acts .lnk:hover{color:#fff}
.top .btn{padding:10px 16px;font-size:15px}
/* hero */
.hero{position:relative;min-height:560px;color:#fff;background:var(--s1) url(/img/hero-2000.webp) center 82%/cover no-repeat;overflow:hidden}
@media(max-width:900px){.hero{background-image:url(/img/hero-1100.webp)}}
.hero::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(18,21,24,.94) 0%,rgba(18,21,24,.82) 40%,rgba(18,21,24,.35) 74%,rgba(18,21,24,.2) 100%)}
.hero .wrap{position:relative;z-index:2;padding-top:110px;padding-bottom:120px}
.hero h1{font:700 clamp(42px,6vw,72px)/1.02 var(--display);margin:0 0 22px;max-width:12.5em}
.hero p{font-size:clamp(17px,1.6vw,20px);line-height:1.55;max-width:34em;margin:0 0 32px;color:#dfe2e5}
.hero .cta{display:flex;gap:14px;flex-wrap:wrap}
/* facts strip */
.facts{border-bottom:1px solid var(--line)}.facts ul{list-style:none;margin:0 auto;padding:36px 24px 40px;max-width:1180px;display:grid;grid-template-columns:repeat(4,1fr);gap:24px}
.facts li{font-size:15px;color:var(--muted);line-height:1.45;border-left:1px solid var(--line);padding-left:16px}.facts strong{display:block;color:#fff;font:700 21px/1.2 var(--display);margin-bottom:2px}
section{padding:88px 0}
.intro{max-width:660px;margin-bottom:52px}
h2{font:700 clamp(34px,4vw,46px)/1.05 var(--display);margin:0 0 16px;color:#fff}
h3{font:700 28px/1.1 var(--display);margin:0 0 12px;color:#fff}
.intro p{color:var(--soft);font-size:19px;margin:0}
.rule{display:block;width:56px;height:4px;background:var(--or);border-radius:2px;margin:0 0 18px}
/* product: screenshot + words, alternating */
.feat{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:56px;align-items:center;margin-bottom:80px}
.feat:last-child{margin-bottom:0}
.feat.flip{grid-template-columns:minmax(0,5fr) minmax(0,7fr)}.feat.flip figure{order:2}
figure.shot{margin:0;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:var(--s2);box-shadow:0 24px 48px -24px rgba(0,0,0,.7)}
.feat p{margin:0 0 12px;color:var(--soft)}
/* example drawings */
.band{background:var(--s1);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sheets{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.sheets a{display:block;text-decoration:none;color:inherit}
.sheets figure{margin:0;background:#fff;border-radius:8px;padding:8px;box-shadow:0 24px 48px -24px rgba(0,0,0,.75);transition:transform .2s ease}
.sheets a:hover figure{transform:translateY(-3px)}@media(prefers-reduced-motion:reduce){.sheets figure{transition:none}.sheets a:hover figure{transform:none}}
.sheets figcaption{color:var(--soft);font-size:15px;margin-top:12px}.sheets figcaption b{color:#fff;font-weight:600}
.sheets .open{color:var(--or-lt);font-weight:600;font-size:14px}
/* working with it */
.points{display:grid;grid-template-columns:repeat(2,1fr);gap:28px 56px}
.points div{background:var(--s1);border:1px solid var(--line);border-radius:10px;padding:22px 24px}.points h3{font-size:23px;margin-bottom:6px}.points p{margin:0;color:var(--soft)}
/* pricing */
.price{display:grid;grid-template-columns:5fr 7fr;gap:56px;align-items:start}
.price>div>p{color:var(--soft);font-size:19px;margin:0}
.pcard{background:var(--s1);border:1px solid var(--line);border-radius:14px;padding:30px 32px;position:relative;overflow:hidden}
.pcard .per{font-size:16px;color:var(--muted);margin:0 0 4px}.pcard .amt{font:700 44px/1 var(--display);margin:0 0 18px;color:#fff}
.pcard ul{margin:0 0 24px;padding:0;list-style:none}.pcard li{padding:9px 0 9px 28px;border-top:1px solid var(--line);position:relative;color:var(--soft)}
.pcard li::before{content:"";position:absolute;left:2px;top:16px;width:12px;height:7px;border-left:3px solid var(--or);border-bottom:3px solid var(--or);transform:rotate(-45deg)}
.pcard small{display:block;color:var(--muted);font-size:14px;margin-top:14px}
/* contact */
.contact{background:var(--s1);border-top:1px solid var(--line)}
.contact .grid{display:grid;grid-template-columns:5fr 7fr;gap:56px}
.contact p{color:var(--soft)}.contact a{color:#fff}
form.c{background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:28px}
form.c fieldset{border:0;margin:0 0 6px;padding:0;display:flex;gap:10px;flex-wrap:wrap}
form.c legend{font-weight:600;font-size:15px;margin-bottom:8px;color:#fff}
form.c .opt{position:relative}form.c .opt input{position:absolute;opacity:0;inset:0;cursor:pointer}
form.c .opt span{display:inline-block;padding:9px 16px;border:2px solid var(--line);border-radius:999px;font-weight:600;font-size:15px;color:var(--soft)}
form.c .opt input:checked+span{border-color:var(--or);background:rgba(242,107,29,.14);color:#fff}form.c .opt input:focus-visible+span{outline:3px solid var(--or);outline-offset:2px}
form.c label{display:block;font-weight:600;font-size:15px;margin:14px 0 5px;color:#fff}
form.c input[type=text],form.c input[type=email],form.c input[type=tel],form.c textarea{width:100%;font:inherit;font-size:16px;padding:11px 13px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:#fff}
form.c input:focus,form.c textarea:focus{border-color:var(--or);outline:none;box-shadow:0 0 0 3px rgba(242,107,29,.25)}
form.c textarea{min-height:110px;resize:vertical}form.c ::placeholder{color:#79808a}
form.c .two{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
form.c .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
form.c .btn{margin-top:20px}form.c .fine{font-size:13.5px;color:var(--muted);margin:14px 0 0}form.c .fine a{color:var(--muted)}
.alert{border-radius:8px;padding:12px 14px;margin:0 0 16px;font-weight:600}.alert.ok{background:rgba(46,160,90,.15);color:#8fe0ad;border:1px solid rgba(46,160,90,.4)}.alert.err{background:rgba(220,60,60,.14);color:#ffaaaa;border:1px solid rgba(220,60,60,.4)}
footer{background:#0c0e10;color:var(--muted);font-size:14px;padding:34px 0;border-top:2px solid var(--or)}
footer .wrap{display:flex;gap:18px 32px;flex-wrap:wrap;align-items:baseline}
footer a{color:var(--soft)}footer .mark{font-size:22px}
footer .src{flex-basis:100%;font-size:13px;color:#757c85;line-height:1.5}
@media(max-width:980px){.top nav{display:none}.feat,.feat.flip,.price,.contact .grid{grid-template-columns:1fr;gap:28px}.feat.flip figure{order:0}.facts ul{grid-template-columns:1fr 1fr}.points,.sheets{grid-template-columns:1fr}}
@media(max-width:640px){.wrap{padding:0 16px}.top .wrap{height:60px;gap:8px 12px}.mark{font-size:23px}
.top .wrap{flex-wrap:nowrap}.top .acts{margin-left:auto;gap:8px}.top .acts .lnk{display:none}.top .btn{padding:8px 12px;font-size:14px}
.hero{min-height:0}.hero .wrap{padding-top:56px;padding-bottom:64px}
section{padding:60px 0}.facts ul{grid-template-columns:1fr;padding:28px 16px 32px;gap:16px}form.c{padding:20px}form.c .two{grid-template-columns:1fr}.pcard{padding:24px}}
.phones{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;align-items:start}.phones figure{margin:0;min-width:0}.phone img{width:100%}
.phone{margin:0;border-radius:28px;overflow:hidden;border:6px solid #2b3138;background:var(--s2);box-shadow:0 24px 48px -24px rgba(0,0,0,.75)}
.phones figcaption{color:var(--soft);font-size:15px;margin-top:12px}.phones figcaption b{color:#fff;font-weight:600;display:block}
.steps{counter-reset:s;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.steps li{background:var(--s1);border:1px solid var(--line);border-radius:10px;padding:22px 24px 22px 66px;position:relative;color:var(--soft)}
.steps li::before{counter-increment:s;content:counter(s);position:absolute;left:20px;top:20px;width:32px;height:32px;border-radius:50%;background:var(--or);color:#fff;font:700 18px/32px var(--display);text-align:center}
.steps b{display:block;color:#fff;font:700 21px/1.2 var(--display);margin-bottom:4px}
@media(max-width:980px){.phones,.steps{grid-template-columns:1fr}.phones{max-width:360px;margin:0 auto}}`;

export function homeHtml(env, u, { sent = '', err = '', v = {} } = {}) {
  const support = esc(env.SUPPORT_EMAIL || 'support@tmwerx.co.uk');
  const price = priceGbp(env);
  const kind = v.kind === 'question' ? 'question' : 'demo';
  const acts = u
    ? `${u.super ? '<a class="lnk" href="/admin">Admin</a>' : ''}<a class="btn btn-ghost" href="${u.super ? '/admin' : ['lead', 'engineer'].includes(u.role) ? '/crew/' : '/app'}">${u.super ? 'Admin dashboard' : 'Open TM WerX'}</a><a class="btn btn-or" href="#contact">Book a demo</a>`
    : `<a class="lnk" href="/crew/">Crew app</a><a class="btn btn-ghost" href="/login">Sign in</a><a class="btn btn-or" href="#contact">Book a demo</a>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TM WerX · Jobs, crews and site records for traffic management</title>
<meta name="theme-color" content="#121518">
<meta name="description" content="TM WerX sends traffic management jobs, drawings and loading lists to your crews' phones, and brings back signed checks, timed photos and a complete record of every site, even where there is no signal.">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="mark" href="/" aria-label="TM WerX home">TM Wer<span>X</span></a>
<nav aria-label="Sections"><a href="#office">Office</a><a href="#crew">Crews</a><a href="#records">Records</a><a href="#pricing">Pricing</a><a href="#contact">Contact</a></nav>
<div class="acts">${acts}</div></div></header>
<main>
<div class="hero"><div class="wrap">
<h1>Every job, crew and site record in one place</h1>
<p>Allocate jobs and drawings to your crews. Their phones get the loading list, the RAMS and the photos you need, and send back signed checks and timed photos, even from a site with no signal.</p>
<div class="cta"><a class="btn btn-or" href="#contact">Book a demo</a><a class="btn btn-ghost" href="#office">See how it works</a></div>
</div></div>

<div class="facts"><ul>
<li><strong>No app store</strong>Crews add it to their home screen from a link: iPhone and Android</li>
<li><strong>Works without signal</strong>Jobs and drawings stay on the phone; records send when signal returns</li>
<li><strong>Photos by rule</strong>On arrival, hourly, at set-up, at removal: set for your company or per client</li>
<li><strong>Linked to CAD WerX</strong>Put an issued CAD WerX drawing and its equipment list straight onto a job</li>
</ul></div>

<section id="office"><div class="wrap">
<div class="intro"><span class="rule"></span><h2>In the office</h2><p>Plan the week, put the right crew and van on each visit, and see what's happening on every site without phoning round.</p></div>
<div class="feat"><figure class="shot"><img src="/img/tm-board.webp" width="1600" height="1000" loading="lazy" alt="The TM WerX board: a week of visits with the crew, van and job for each"></figure>
<div><h3>Jobs, visits and crews</h3><p>Make a job from a client's email or WhatsApp: forward it to your TM WerX address and the site, dates and type of traffic management are picked out for you to check.</p>
<p>Add the visits, choose the crew and the van, and send it to their phones. TM WerX warns you about clashes, expired cards and vans reported unsafe. Change anything and the crew see "Updated" with what changed.</p></div></div>
<div class="feat flip"><figure class="shot"><img src="/img/tm-live.webp" width="1600" height="1000" loading="lazy" alt="The TM WerX live view: visits under way, each crew's progress, photos due and alerts"></figure>
<div><h3>Live: what needs you now</h3><p>See which crews are on site, how far each visit has got, and which photos are due or overdue. Missed photos, sites that don't match the drawing, vehicle defects, near misses and missed lone-worker check-ins come straight to you.</p>
<p>A panic alarm from a phone sends its position to the office and emails every office user.</p></div></div>
</div></section>

<section id="crew" class="band"><div class="wrap">
<div class="intro"><span class="rule"></span><h2>On site</h2><p>One screen per visit, in the order the work happens. Each step takes a tap or a signature, and nothing is lost when the signal drops.</p></div>
<div class="phones">
<figure><div class="phone"><img src="/img/tm-crew-visit.webp" width="780" height="1500" loading="lazy" alt="The crew app: the steps for a visit, from accepting the job to signing out"></div><figcaption><b>The day's steps</b>Accept, vehicle check, load the van, sign the RAMS, check the drawing, sign in on site, then start.</figcaption></figure>
<figure><div class="phone"><img src="/img/tm-crew-load.webp" width="780" height="1500" loading="lazy" alt="The crew app: the loading list from the drawing, with spares added"></div><figcaption><b>Load from the drawing</b>The equipment list comes from the drawing with your spares added. It's counted back at the end, and anything left on site is flagged.</figcaption></figure>
<figure><div class="phone"><img src="/img/tm-crew-photos.webp" width="780" height="1500" loading="lazy" alt="The crew app: photos due now, from the company's photo rules"></div><figcaption><b>Photos when they're due</b>The phone asks for each photo when it falls due. A photo taken on time counts as on time, even if it sends later.</figcaption></figure>
</div></div></section>

<section id="records"><div class="wrap">
<div class="intro"><span class="rule"></span><h2>A record you can stand behind</h2><p>Everything from site is kept exactly as it was sent, with the time on the phone and the time it arrived.</p></div>
<div class="points">
<div><h3>Evidence packs</h3><p>One printable pack per job: the drawing revisions, RAMS sign-offs, vehicle checks, arrival times, the photo schedule and every photo with its fingerprint. Share it with the client by link.</p></div>
<div><h3>Nothing is overwritten</h3><p>Records from site can't be edited. The office adds notes and corrections alongside them, and every change to a job is logged.</p></div>
<div><h3>Your documents, versioned</h3><p>Write your risk assessment, method statement and vehicle check once. Each change is a new version, and only an administrator can approve one.</p></div>
<div><h3>Time, costs and safety</h3><p>Timesheets from sign-in and sign-out with your working-time limits, costs and margin per job, near misses, audits and the actions that follow.</p></div>
</div>
<ol class="steps" style="margin-top:56px">
<li><b>Send the link</b>Your crews open ${esc(new URL('https://' + (env.INTAKE_DOMAIN || 'tmwerx.co.uk')).host)}/crew on their phone and sign in with the username you give them.</li>
<li><b>Add to home screen</b>The first sign-in shows them how. It then opens full screen like any app.</li>
<li><b>Switch on alerts</b>New jobs, changes, returned visits and photos due arrive as notifications.</li>
</ol></div></section>

<section id="pricing" class="band"><div class="wrap price">
<div><span class="rule"></span><h2>Pricing</h2><p>One price per user, per month: office staff and crew alike. Book a demo and we'll talk you through it.</p></div>
<div class="pcard"><p class="per">Per user, per month</p><p class="amt">${price ? '£' + price : 'Price to be confirmed'}</p>
<ul><li>Jobs, visits, crews and vans</li><li>Crew app for iPhone and Android, no app store</li><li>Photo rules for your company and each client</li><li>Evidence packs, timesheets and costs</li><li>Add or remove users at any time, monthly with no minimum term</li></ul>
<a class="btn btn-or" href="#contact">Book a demo</a><small>${esc(('For businesses only. ' + vatNote(env)).trim())}</small></div>
</div></section>

<section id="contact" class="contact"><div class="wrap grid">
<div><span class="rule"></span><h2>Get in touch</h2><p>Book a demo and we'll set up one of your own jobs, with a crew phone, while we talk. Or ask us anything about TM WerX.</p>
<p>Email us at <a href="mailto:${support}">${support}</a>.</p></div>
<form class="c" method="post" action="/contact" novalidate>
${sent ? `<p class="alert ok" role="status">Thanks, your message has been sent. We'll reply by email.</p>` : ''}${err ? `<p class="alert err" role="alert">${esc(err)}</p>` : ''}
<fieldset><legend>What would you like?</legend>
<label class="opt" style="margin:0"><input type="radio" name="kind" value="demo"${kind === 'demo' ? ' checked' : ''}><span>Book a demo</span></label>
<label class="opt" style="margin:0"><input type="radio" name="kind" value="question"${kind === 'question' ? ' checked' : ''}><span>Ask a question</span></label></fieldset>
<div class="two"><div><label for="c_name">Your name</label><input id="c_name" name="name" type="text" required maxlength="120" autocomplete="name" value="${esc(v.name || '')}"></div>
<div><label for="c_company">Company</label><input id="c_company" name="company" type="text" maxlength="120" autocomplete="organization" value="${esc(v.company || '')}"></div>
<div><label for="c_email">Email</label><input id="c_email" name="email" type="email" required autocomplete="email" value="${esc(v.email || '')}"></div>
<div><label for="c_phone">Phone (optional)</label><input id="c_phone" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(v.phone || '')}"></div></div>
<label for="c_msg">Message</label><textarea id="c_msg" name="message" maxlength="4000" placeholder="For a demo, tell us roughly how many crews you run and when suits you.">${esc(v.message || '')}</textarea>
<div class="hp" aria-hidden="true"><label for="c_web">Leave this empty</label><input id="c_web" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<button class="btn btn-or" type="submit">Send</button>
<p class="fine">We use these details only to reply to you. See our <a href="/privacy">privacy policy</a>.</p></form>
</div></section>
</main>
<footer><div class="wrap"><a class="mark" href="/">TM Wer<span>X</span></a><span>© ${new Date().getFullYear()} ${esc(env.PROVIDER_NAME || 'Hades WerX Limited')}</span>
<a href="/terms">Customer agreement</a><a href="/privacy">Privacy and cookies</a><a href="/about">Data sources</a><a href="https://cadwerx.co.uk">CAD WerX</a><a href="mailto:${support}">${support}</a>
<p class="src">Photo of road works in Leeds by Look Again Digital on Unsplash. Postcode positions from postcodes.io (contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; National Statistics data © Crown copyright).</p><p class="src">${esc(companyLine(env))}</p></div></footer>
</body></html>`;
}

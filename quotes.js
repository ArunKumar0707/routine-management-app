/* DayFlow — rotating motivational quote.
 * Edit the QUOTES list below to add or remove your own ({ t: 'text', a: 'author' }).
 * The quote changes on its own at the interval chosen in the card (default: every 30 minutes),
 * and the ↻ button shows the next one straight away. */
(function () {
  'use strict';
  const QUOTES = [
    { t: 'The journey of a thousand miles begins with a single step.', a: 'Lao Tzu' },
    { t: 'Success is the sum of small efforts, repeated day in and day out.', a: 'Robert Collier' },
    { t: 'Start where you are. Use what you have. Do what you can.', a: 'Arthur Ashe' },
    { t: 'How we spend our days is, of course, how we spend our lives.', a: 'Annie Dillard' },
    { t: 'Either you run the day, or the day runs you.', a: 'Jim Rohn' },
    { t: 'Don’t watch the clock; do what it does. Keep going.', a: 'Sam Levenson' },
    { t: 'Lost time is never found again.', a: 'Benjamin Franklin' },
    { t: 'Well done is better than well said.', a: 'Benjamin Franklin' },
    { t: 'Energy and persistence conquer all things.', a: 'Benjamin Franklin' },
    { t: 'Nothing will work unless you do.', a: 'Maya Angelou' },
    { t: 'The only way to do great work is to love what you do.', a: 'Steve Jobs' },
    { t: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', a: 'Will Durant' },
    { t: 'It does not matter how slowly you go as long as you do not stop.', a: 'Confucius' },
    { t: 'Perseverance is not a long race; it is many short races one after the other.', a: 'Walter Elliot' },
    { t: 'Little by little, one travels far.', a: 'J.R.R. Tolkien' },
    { t: 'Amateurs sit and wait for inspiration. The rest of us just get up and go to work.', a: 'Stephen King' },
    { t: 'Plans are nothing; planning is everything.', a: 'Dwight D. Eisenhower' },
    { t: 'Procrastination is the thief of time.', a: 'Edward Young' },
    { t: 'Small deeds done are better than great deeds planned.', a: 'Peter Marshall' },
    { t: 'What you do every day matters more than what you do once in a while.', a: 'Gretchen Rubin' },
    { t: 'Discipline is the bridge between goals and accomplishment.', a: 'Jim Rohn' },
    { t: 'You don’t have to be great to start, but you have to start to be great.', a: 'Zig Ziglar' },
    { t: 'Today’s accomplishments were yesterday’s impossibilities.', a: 'Robert H. Schuller' },
    { t: 'Take rest; a field that has rested gives a bountiful crop.', a: 'Ovid' },
    { t: 'Begin anywhere.', a: 'John Cage' },
    { t: 'Focus on being productive instead of busy.', a: 'Tim Ferriss' },
    { t: 'You will never change your life until you change something you do daily.', a: 'John C. Maxwell' },
    { t: 'Motivation gets you going, but discipline keeps you growing.', a: 'John C. Maxwell' },
    { t: 'Excellence is not a destination; it is a continuous journey that never ends.', a: 'Brian Tracy' },
    { t: 'Dost thou love life? Then do not squander time, for that is the stuff life is made of.', a: 'Benjamin Franklin' },
    { t: 'Well begun is half done.', a: 'Proverb' },
    { t: 'The best time to plant a tree was twenty years ago. The second best time is now.', a: 'Proverb' },
    { t: 'Fall seven times, stand up eight.', a: 'Japanese proverb' },
    { t: 'A little progress each day adds up to big results.', a: 'Proverb' },
    { t: 'Do the hard thing first; the rest of the day gets easier.', a: 'Proverb' },
    { t: 'One day or day one — you decide.', a: 'Proverb' },
    { t: 'Rest when you need to, but never quit.', a: 'Proverb' },
    { t: 'Make today count.', a: 'Proverb' }
  ];
  const KEY = 'dayflow.quote.v1';
  const OPTIONS = [1, 5, 15, 30, 60, 1440];          // minutes
  const $ = s => document.querySelector(s);

  function load() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY));
      return { every: OPTIONS.includes(r && r.every) ? r.every : 30, bump: Number.isFinite(r && r.bump) ? r.bump : 0 };
    } catch (e) { return { every: 30, bump: 0 }; }
  }
  const cfg = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const n = QUOTES.length;
  // A step that is coprime with n visits every quote before repeating, in a scattered (not alphabetical) order.
  let step = Math.max(1, Math.round(n * 0.382));
  while (gcd(step, n) !== 1) step++;

  function slot() {
    const local = Date.now() - new Date().getTimezoneOffset() * 60000;   // local-time based, so "daily" flips at local midnight
    return Math.floor(local / (cfg.every * 60000));
  }
  const indexFor = (sl, bump) => (((sl * step + bump) % n) + n) % n;

  let shownKey = null;
  function render(force) {
    const key = slot() + ':' + cfg.bump + ':' + cfg.every;
    if (!force && key === shownKey) return;
    const first = shownKey === null;
    shownKey = key;
    const q = QUOTES[indexFor(slot(), cfg.bump)];
    const body = $('#quoteBody');
    const apply = () => {
      $('#quoteText').textContent = q.t;
      $('#quoteAuthor').textContent = q.a ? '— ' + q.a : '';
      body.classList.remove('fading');
    };
    if (first) apply(); else { body.classList.add('fading'); setTimeout(apply, 220); }
  }

  function init() {
    if (!$('#quoteBody')) return;
    const sel = $('#quoteEvery');
    sel.value = String(cfg.every);
    sel.addEventListener('change', () => { cfg.every = Number(sel.value); save(); render(true); });
    $('#quoteNext').addEventListener('click', () => { cfg.bump += 1; save(); render(true); });
    render(true);
    setInterval(() => render(false), 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(false); });
  }
  window.DayFlowQuotes = { count: n, indexFor, slot, QUOTES };
  init();
})();

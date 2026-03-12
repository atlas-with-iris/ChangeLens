// ═══════════════════════════════════════════════════════════════════
// ChangeLens Landing — Terminal Animation & Interactions
// ═══════════════════════════════════════════════════════════════════

// ── TERMINAL TYPING ANIMATION ─────────────────────────────────────

const COMMAND = 'git diff main | npx changelens --project ./api';

const OUTPUT = `
<span class="t-cyan">  ═══════════════════════════════════════════════════════════════</span>
<span class="t-cyan t-bold">  🔍 ChangeLens — Impact Estimate</span>
<span class="t-cyan">  ═══════════════════════════════════════════════════════════════</span>

  <span class="t-red">█ 🔴 HIGH RISK █</span>  <span class="t-red">Potential breaking change detected</span>

  <span class="t-bold">Summary</span>
  <span class="t-dim">2 file(s) changed across AUTH, UTILITY surfaces — 12 line(s) modified, 23 downstream consumer(s)</span>

  <span class="t-bold">Why this risk tier?</span>
  <span class="t-white">Export signature changed with 23 downstream consumer(s)</span>

  <span class="t-bold">Affected Surfaces</span>
  <span class="t-red">▸</span> AUTH: src/auth/middleware.js (2 symbol(s): validateToken, AUTH_VERSION)
  <span class="t-cyan">▸</span> UTILITY: src/utils/format.js (1 symbol(s): formatResponse)

  <span class="t-bold">Downstream Consumers</span>
  <span class="t-red">23</span> file(s) import from changed surfaces:

  <span class="t-dim">  └─</span> src/routes/users.js
  <span class="t-dim">  └─</span> src/routes/admin.js
  <span class="t-dim">  └─</span> src/routes/profile.js
  <span class="t-dim">  └─</span> src/api/v2/gateway.js
  <span class="t-dim">  └─</span> <span class="t-dim">...and 19 more</span>

  <span class="t-bold">Evidence</span>
  <span class="t-red">⚡</span> modified function "validateToken" in src/auth/middleware.js
  <span class="t-yellow">⚡</span> 23 downstream file(s) import from changed surfaces
  <span class="t-red">⚡</span> export signature change detected — verify compatibility

<span class="t-dim">  ──────────────────────────────────────────────────────────────</span>

  <span class="t-yellow">⚠️  Review required</span> — Review downstream consumers before merging.

  <span class="t-dim">ChangeLens · 47ms · 156 files scanned · static analysis · not a guarantee</span>
`;

function typeCommand() {
  const cmdEl = document.getElementById('typed-cmd');
  const cursorEl = document.getElementById('cursor');
  const outputEl = document.getElementById('terminal-output');
  let i = 0;

  function typeChar() {
    if (i < COMMAND.length) {
      cmdEl.textContent += COMMAND[i];
      i++;
      setTimeout(typeChar, 30 + Math.random() * 40);
    } else {
      // Command done — hide cursor, show output
      cursorEl.style.display = 'none';
      setTimeout(() => {
        outputEl.innerHTML = OUTPUT;
        outputEl.classList.add('visible');
      }, 400);
    }
  }

  // Start after a short delay
  setTimeout(typeChar, 1200);
}

// ── SCROLL ANIMATIONS ─────────────────────────────────────────────

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
      }
    });
  }, { threshold: 0.15 });

  // Observe pipeline steps
  document.querySelectorAll('.pipeline-step').forEach(el => {
    el.classList.add('animate-target');
    observer.observe(el);
  });

  // Observe pricing cards
  document.querySelectorAll('.price-card').forEach(el => {
    el.classList.add('animate-target');
    observer.observe(el);
  });

  // Observe stat numbers
  document.querySelectorAll('.stat').forEach(el => {
    el.classList.add('animate-target');
    observer.observe(el);
  });

  // Observe install cards
  document.querySelectorAll('.install-card').forEach(el => {
    el.classList.add('animate-target');
    observer.observe(el);
  });
}

// ── ADD ANIMATION STYLES ──────────────────────────────────────────

const animStyles = document.createElement('style');
animStyles.textContent = `
  .animate-target {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }
  .animate-target.animate-in {
    opacity: 1;
    transform: translateY(0);
  }
  .pipeline-step.animate-target { transition-delay: calc(var(--i, 0) * 0.08s); }
  .price-card.animate-target { transition-delay: calc(var(--i, 0) * 0.1s); }
`;
document.head.appendChild(animStyles);

// Set stagger indices
document.querySelectorAll('.pipeline-step').forEach((el, i) => el.style.setProperty('--i', i));
document.querySelectorAll('.price-card').forEach((el, i) => el.style.setProperty('--i', i));

// ── NAV SCROLL EFFECT ─────────────────────────────────────────────

window.addEventListener('scroll', () => {
  const nav = document.getElementById('nav');
  if (window.scrollY > 100) {
    nav.style.background = 'rgba(10, 10, 15, 0.95)';
  } else {
    nav.style.background = 'rgba(10, 10, 15, 0.85)';
  }
});

// ── SMOOTH SCROLL FOR ANCHOR LINKS ────────────────────────────────

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── INIT ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  typeCommand();
  initScrollAnimations();
});

// Mobile menu
(function () {
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  if (!header || !toggle) return;
  toggle.addEventListener('click', function () {
    var open = header.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
})();

// "Copy link" button on article pages
(function () {
  var btn = document.querySelector('[data-copy-link]');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var done = function () {
      btn.textContent = 'Link copied';
      setTimeout(function () { btn.textContent = 'Copy link'; }, 2000);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(window.location.href).then(done);
    else done();
  });
})();

    // Apply saved theme before first paint to avoid a flash of the wrong theme.
    (function () {
      try {
        var t = localStorage.getItem('ct-theme');
        if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      } catch (e) {}
    })();

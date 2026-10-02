(() => {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#site-nav");

  const closeMenu = () => {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
  };

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".nav-shell")) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  const indexes = document.querySelectorAll(".page-index, .article-index");
  const wideLayout = window.matchMedia("(min-width: 1340px)");

  indexes.forEach((index) => {
    index.open = wideLayout.matches;

    const links = [...index.querySelectorAll('a[href^="#"]')];
    const sections = links
      .map((link) => {
        const id = decodeURIComponent(link.hash.slice(1));
        return { link, target: document.getElementById(id) };
      })
      .filter(({ target }) => target);

    let anchorTop = 0;
    let ticking = false;
    const updateIndexPosition = () => {
      index.classList.toggle(
        "is-stuck",
        wideLayout.matches && window.scrollY + 16 >= anchorTop
      );
    };

    const measureIndexPosition = () => {
      index.classList.remove("is-stuck");
      anchorTop = index.getBoundingClientRect().top + window.scrollY;
      updateIndexPosition();
    };

    const updateCurrentSection = () => {
      let current = sections[0];
      const readingLine = window.innerHeight * 0.28;

      sections.forEach((section) => {
        if (section.target.getBoundingClientRect().top <= readingLine) current = section;
      });

      sections.forEach(({ link }) => {
        const isCurrent = link === current?.link;
        link.classList.toggle("active", isCurrent);
        if (isCurrent) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
      updateIndexPosition();
      ticking = false;
    };

    const queueSectionUpdate = () => {
      if (ticking) return;
      window.requestAnimationFrame(updateCurrentSection);
      ticking = true;
    };

    links.forEach((link) => {
      link.addEventListener("click", () => {
        if (!wideLayout.matches) index.open = false;
      });
    });
    window.addEventListener("scroll", queueSectionUpdate, { passive: true });
    window.addEventListener("resize", () => {
      window.requestAnimationFrame(measureIndexPosition);
      queueSectionUpdate();
    });
    measureIndexPosition();
    updateCurrentSection();
  });

  wideLayout.addEventListener("change", (event) => {
    indexes.forEach((index) => { index.open = event.matches; });
    window.dispatchEvent(new Event("resize"));
  });

  const links = document.querySelectorAll(".citation-link, .reference-link");
  if (!links.length) return;

  const preview = document.createElement("div");
  preview.className = "link-preview";
  preview.setAttribute("role", "dialog");
  preview.setAttribute("aria-label", "Source preview");
  preview.innerHTML =
    '<div class="link-preview-bar">' +
      '<span class="link-preview-title"></span>' +
      '<a class="link-preview-open" target="_blank" rel="noreferrer">open ↗</a>' +
    '</div>' +
    '<span class="link-preview-destination"></span>' +
    '<div class="link-preview-frame-wrap">' +
      '<span class="link-preview-loading">loading source…</span>' +
      '<iframe class="link-preview-frame" title="Linked source preview" ' +
        'sandbox="allow-forms allow-popups allow-same-origin allow-scripts" ' +
        'referrerpolicy="no-referrer"></iframe>' +
    '</div>';
  document.body.append(preview);

  const title = preview.querySelector(".link-preview-title");
  const destination = preview.querySelector(".link-preview-destination");
  const openLink = preview.querySelector(".link-preview-open");
  const frame = preview.querySelector(".link-preview-frame");
  let timer;
  let activeURL = "";

  const place = (link) => {
    const rect = link.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const gap = 10;
    let left = Math.max(gap, rect.left);
    let top = rect.bottom + gap;

    left = Math.min(left, window.innerWidth - previewRect.width - gap);
    if (top + previewRect.height > window.innerHeight - gap) {
      top = rect.top - previewRect.height - gap;
    }

    preview.style.left = `${Math.max(gap, left)}px`;
    preview.style.top = `${Math.max(gap, top)}px`;
  };

  const show = (link) => {
    const url = new URL(link.href, window.location.href);
    title.textContent = link.textContent.trim().replace(/\[\d+\]$/, "");
    destination.textContent = url.hostname || url.pathname;
    openLink.href = url.href;

    if (activeURL !== url.href) {
      activeURL = url.href;
      preview.classList.remove("loaded");
      frame.src = url.href;
    }

    preview.classList.add("visible");
    place(link);
  };

  const hideNow = () => {
    clearTimeout(timer);
    preview.classList.remove("visible");
  };

  const hideSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(hideNow, 160);
  };

  frame.addEventListener("load", () => preview.classList.add("loaded"));
  preview.addEventListener("mouseenter", () => clearTimeout(timer));
  preview.addEventListener("mouseleave", hideSoon);
  preview.addEventListener("focusin", () => clearTimeout(timer));
  preview.addEventListener("focusout", hideSoon);

  links.forEach((link) => {
    link.addEventListener("mouseenter", () => {
      clearTimeout(timer);
      timer = setTimeout(() => show(link), 350);
    });
    link.addEventListener("mouseleave", hideSoon);
    link.addEventListener("focus", () => show(link));
    link.addEventListener("blur", hideSoon);
  });

  window.addEventListener("scroll", hideNow, { passive: true });
  window.addEventListener("resize", hideNow);
})();

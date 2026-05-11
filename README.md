# Personal site

Built with [Hugo](https://gohugo.io/) using Claude.

## Layout

```
.
├── hugo.toml                    site config
├── content/
│   ├── _index.md                home (front matter only; body is the template)
│   ├── resume.md                résumé (front matter only; body is the template)
│   └── blog/
│       ├── _index.md            blog landing
│       └── *.md                 individual posts
├── layouts/
│   ├── _default/
│   │   ├── baseof.html          shared <head>, wrap, footer
│   │   └── resume.html          résumé layout
│   ├── index.html               long-form home layout
│   ├── blog/
│   │   ├── list.html            blog index
│   │   └── single.html          individual post
│   └── partials/
│       ├── masthead.html        nav + name + handles + blurb
│       └── footer.html
├── static/
│   └── style.css                the only stylesheet
├── archetypes/
│   └── default.md               template for `hugo new`
└── .github/workflows/hugo.yml   GitHub Pages deploy
```

## New post

```sh
hugo new blog/some-slug.md
$EDITOR content/blog/some-slug.md
```

## Dev build

```sh
hugo server -D
xdg-open http://localhost:1313/
```

## Prod build

```sh
hugo --gc --minify
```

`./public/` is static site

## License

Code: MIT. Content: all rights reserved.

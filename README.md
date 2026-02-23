# TestingImageTool

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Convert to DZI file
documentation: https://www.libvips.org/API/current/making-image-pyramids.html. 

### Install libvips
```sh
brew install vips
```
## CLI
```sh
vips dzsave mosaic.jpg dzi/mosaic --tile-size 256 --overlap 0 --suffix ".png"
```

## Serving files via nginx
url: http://localhost:8080/dzi/

```nginx
server {

    listen 8080;

    server_name localhost;
    location /dzi/ {
                alias /path/to/your/dzi/folder; # example: /Users/../../dzi/
                autoindex on;
                add_header Access-Control-Allow-Origin * always;
                }
            }
}
```

**Sample folder**
```
dzi/
├── mosaic.dzi
└── mosaic_files/
```

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

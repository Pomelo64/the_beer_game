import io, os, sys
here = os.path.dirname(os.path.abspath(__file__)); src = os.path.join(here, 'src')
rd = lambda n: io.open(os.path.join(src, n), encoding='utf-8').read()
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@500;600&display=swap">'
page = ('<meta name="claude:viewport-fit-sides" content="cover">\n<title>Pub Supply Game</title>\n' + fonts +
        '\n<style>\n' + rd('style.css') + '</style>\n' + rd('body.html') +
        '<script>\n' + rd('engine.js') + '\n' + rd('ui.js') + '</script>\n')
io.open(os.path.join(here, 'pub-supply-game.html'), 'w', encoding='utf-8').write(page)
standalone = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
  + page.split('<div class="wrap">')[0] + '</head>\n<body>\n<div class="wrap">' + page.split('<div class="wrap">', 1)[1] + '</body>\n</html>\n')
io.open(os.path.join(here, 'index.html'), 'w', encoding='utf-8').write(standalone)
print(len(page), len(standalone))

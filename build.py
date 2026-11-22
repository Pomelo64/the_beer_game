import io, json, os, sys
here = os.path.dirname(os.path.abspath(__file__)); src = os.path.join(here, 'src')
rd = lambda n: io.open(os.path.join(src, n), encoding='utf-8').read()
def canvas_js():
    """SFD Studio's canvas page, unchanged except that its Edit mode (equations) is hidden,
    as a string the modelling step loads into a frame."""
    html = rd('sfd/canvas.html')
    assert html.count('</head>') == 1
    html = html.replace('</head>', '<style>/* added by Beer Game Lab: no equations in this exercise */ #modeToggle{display:none!important}</style>\n</head>')
    # Flow pipes are always straight. With 'bezier', cytoscape 3.30 groups a pipe with an
    # information link that joins the same two elements and bends them apart whenever both
    # are redrawn together (for example on hovering the stock). 'straight' is never grouped.
    old = "{ selector: 'edge[type=\"flowseg\"]', style: {\n        'curve-style': 'bezier',"
    assert html.count(old) == 1
    html = html.replace(old, "{ selector: 'edge[type=\"flowseg\"]', style: {\n        'curve-style': 'straight', /* Beer Game Lab: was 'bezier' */")
    return 'const CANVAS_HTML = ' + json.dumps(html).replace('</', '<\\/') + ';'
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@500;600&display=swap">'
page = ('<meta name="claude:viewport-fit-sides" content="cover">\n<title>Beer Game Lab</title>\n' + fonts +
        '\n<style>\n' + rd('style.css') + '</style>\n' + rd('body.html') +
        '<script>\n' + canvas_js() + '\n' + rd('engine.js') + '\n' + rd('sfd/key.js') + '\n' + rd('sfd/marking.js') + '\n' + rd('sfd/picture.js') + '\n' + rd('sfd/process_log.js') + '\n' +
        rd('sfd/llm_client.js') + '\n' + rd('sfd/model_ui.js') + '\n' + rd('ui.js') + '</script>\n')
io.open(os.path.join(here, 'beer-game-lab.html'), 'w', encoding='utf-8').write(page)
standalone = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
  + page.split('<div class="wrap">')[0] + '</head>\n<body>\n<div class="wrap">' + page.split('<div class="wrap">', 1)[1] + '</body>\n</html>\n')
io.open(os.path.join(here, 'index.html'), 'w', encoding='utf-8').write(standalone)
print(len(page), len(standalone))

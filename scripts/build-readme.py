from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import argparse
import base64
import hashlib
import json
import os
import re

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONTS = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
SCALE = 2
WIDTH = 880
HEIGHT = 700
FRAME_MS = 70
PAPER = '#f3f5f3'
INK = '#1c3038'
MUTED = '#6f7c82'
LINE = '#cfd8d8'
ACCENT = '#527d8c'
ARCHIVE = 'PromptQueue'
APP_OFFSET = (476, 58)
CHAT_OFFSET = (24, 58)
APP_SIZE = (380, 624)
CHAT_SIZE = (440, 624)

CHAT_HTML = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>写出想要的感觉 - ChatGPT</title>
<style>
*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;background:#fff;color:#202123;font:15px/1.7 "Segoe UI","Microsoft YaHei",sans-serif;display:flex;flex-direction:column}
header{height:62px;padding:17px 24px;border-bottom:1px solid #edf0ef;flex-shrink:0;font-size:19px;font-weight:600}
main{flex:1;min-height:0;overflow:auto;padding:18px 22px;scrollbar-width:none}
.welcome{height:280px;display:grid;place-items:center;font-size:22px;font-weight:600;color:#647a80}
article{margin-bottom:20px}.user,.assistant{width:fit-content;max-width:88%;padding:12px 16px;font-size:14px;line-height:1.8}
.user{margin-left:auto;background:#eaf1f4;border-radius:18px 18px 6px 18px;color:#263c45}
.assistant{margin-right:auto;background:#f4f6f5;border-radius:18px 18px 18px 6px}
.whitespace-pre-wrap,.markdown{white-space:pre-wrap;overflow-wrap:anywhere}
.user .whitespace-pre-wrap{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:7;overflow:hidden}
.user p{margin:0 0 8px}.user p:last-child{margin-bottom:0}.user pre{margin:0;white-space:pre-wrap;font:inherit}
.attachments{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.file{border:1px solid #d2dcda;background:#fff;padding:6px 9px;border-radius:7px;font-size:12px;color:#4c6971}
form{margin:0 18px 18px;padding:13px 14px 10px;border:1px solid #d1dcda;border-radius:18px;background:#f9fbfa;flex-shrink:0;position:relative}
#prompt-textarea{min-height:43px;outline:0;max-height:100px;overflow:auto;padding-right:30px;white-space:pre-wrap}
#prompt-textarea:empty:before{content:"询问任何问题";color:#8c999c}
button{cursor:pointer}#send{position:absolute;bottom:12px;right:12px;width:28px;height:28px;border:0;border-radius:50%;background:#23383d;color:#fff;font-size:16px}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0;left:12px;bottom:10px}
.attached{display:inline-flex;align-items:center;gap:5px;margin:0 5px 5px 0;padding:5px 7px;border:1px solid #cbd8d5;border-radius:6px;background:#fff;font-size:11px}
.attached button{border:0;background:transparent;color:#647b7f}
</style></head><body>
<header>ChatGPT</header><main><div class="welcome"></div></main>
<form data-chatgpt-composer onsubmit="return false">
<input type="file" multiple aria-label="Attach files">
<div id="prompt-textarea" contenteditable="true" role="textbox"></div>
<button id="send" type="button" data-testid="send-button" aria-label="Send prompt">↑</button>
</form>
<script>
window.delivered=[];
const form=document.querySelector('form'),main=document.querySelector('main'),editor=document.querySelector('#prompt-textarea'),send=document.querySelector('#send');
function scrollChat(){main.scrollTop=main.scrollHeight}
document.querySelector('input[type=file]').onchange=event=>{
  for(const file of event.target.files){
    const chip=document.createElement('div');chip.className='attached';chip.setAttribute('data-testid','attachment-preview');
    const name=document.createElement('span');name.textContent=file.name;name.setAttribute('aria-label',file.name);
    const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove '+file.name);remove.textContent='×';remove.onclick=()=>chip.remove();
    chip.append(name,remove);form.insertBefore(chip,editor);
  }
};
send.onclick=()=>{
  if(send.dataset.testid==='stop-button')return;
  document.querySelector('.welcome')?.remove();
  const text=editor.innerText.replace(/\n{3,}/g,'\n\n'),names=[...form.querySelectorAll('.attached span')].map(el=>el.textContent);
  window.delivered.push({text,names});
  const turn=document.createElement('article');turn.dataset.testid='conversation-turn-'+(delivered.length*2-1);
  const user=document.createElement('div');user.className='user';user.dataset.messageAuthorRole='user';user.dataset.messageId='user-'+delivered.length;
  if(names.length){const files=document.createElement('div');files.className='attachments';for(const name of names){const item=document.createElement('span');item.className='file';item.textContent=name;files.append(item)}user.append(files)}
  const body=document.createElement('div');body.className='whitespace-pre-wrap';body.innerHTML=marked.parse(text,{breaks:true});user.append(body);turn.append(user);main.append(turn);
  for(const chip of form.querySelectorAll('.attached'))chip.remove();
  editor.textContent='';
  const answer=document.createElement('article');answer.hidden=true;answer.dataset.testid='conversation-turn-'+(delivered.length*2);
  answer.innerHTML='<div class="assistant" data-message-author-role="assistant" data-message-id="assistant-'+delivered.length+'"><div class="markdown"></div></div>';
  main.append(answer);window.answer=answer.querySelector('.markdown');
  send.dataset.testid='stop-button';send.setAttribute('aria-label','Stop streaming');send.textContent='■';scrollChat();
};
window.showReply=text=>{
  window.answer.textContent=text;
  window.answer.closest('article').hidden=false;
  send.dataset.testid='send-button';send.setAttribute('aria-label','Send prompt');send.textContent='↑';
  scrollChat();
};
</script></body></html>'''


def scaled(values):
    return tuple(round(value * SCALE) for value in values)


@lru_cache(maxsize=None)
def font(size, family='ui'):
    names = {'ui': 'msyh.ttc', 'bold': 'msyhbd.ttc', 'mono': 'consola.ttf'}
    return ImageFont.truetype(str(FONTS / names[family]), round(size * SCALE))


def text(draw, position, value, size=15, color=INK, family='ui', anchor=None):
    draw.text(scaled(position), value, font=font(size, family), fill=color, anchor=anchor)


def rectangle(draw, bounds, fill, outline=None, radius=7, width=1):
    draw.rounded_rectangle(scaled(bounds), radius=round(radius * SCALE), fill=fill,
                           outline=outline, width=round(width * SCALE))


def line(draw, points, color=LINE, width=1):
    draw.line([scaled(point) for point in points], fill=color, width=round(width * SCALE), joint='curve')


def ease(value):
    value = min(1, max(0, value))
    return value * value * (3 - 2 * value)


def position(start, end, fraction):
    amount = ease(fraction)
    return tuple(a + (b - a) * amount for a, b in zip(start, end))


def pointer(image, point, click=None):
    draw = ImageDraw.Draw(image)
    x, y = point
    if click is not None and 0 <= click < .42:
        radius = 7 + click * 37
        color = tuple(round(a + (b - a) * click / .42)
                      for a, b in zip((82, 125, 140), (239, 244, 241)))
        draw.ellipse(scaled((x-radius, y-radius, x+radius, y+radius)),
                     outline=color, width=2*SCALE)
    shape = [(0, 0), (0, 20), (5, 15), (10, 25), (14, 23), (9, 13), (20, 13)]
    draw.polygon([scaled((x+dx, y+dy)) for dx, dy in shape], fill='#fff',
                 outline='#263f48', width=SCALE)


def icon(image, point, size=24):
    with Image.open(ROOT / 'icons/icon128.png') as source:
        image.paste(source.convert('RGB').resize((size*SCALE, size*SCALE), Image.Resampling.LANCZOS),
                    scaled(point))


def browser_frame(address):
    image = Image.new('RGB', (WIDTH*SCALE, HEIGHT*SCALE), PAPER)
    draw = ImageDraw.Draw(image)
    row = 24
    rectangle(draw, (14, 12, 866, 688), '#fff', LINE, 12)
    rectangle(draw, (15, 13, 865, row+28), '#eef1ef', radius=11)
    draw.rectangle(scaled((15, row-2, 865, row+28)), fill='#eef1ef')
    line(draw, [(39, row+6), (32, row+12), (39, row+18)], '#718489')
    line(draw, [(32, row+12), (45, row+12)], '#718489')
    rectangle(draw, (56, row, 797, row+23), '#fff', '#d9e1dc', 12)
    text(draw, (75, row+3), address, 12, '#61777e', 'mono')
    for x in (842, 847, 852):
        draw.ellipse(scaled((x, row+11, x+2, row+13)), fill='#637b82')
    line(draw, [(15, row+29), (865, row+29)])
    return image


@dataclass
class Shot:
    image: Image.Image
    duration: int


def append_hold(shots, image, duration, point=None):
    frame = image.copy() if point else image
    if point:
        pointer(frame, point)
    shots.append(Shot(frame, duration))


def append_move(shots, image, start, end, duration=560, click=False):
    count = max(1, round(duration / FRAME_MS))
    for index in range(count):
        frame = image.copy()
        pointer(frame, position(start, end, (index+1)/count))
        shots.append(Shot(frame, FRAME_MS))
    if click:
        for index in range(5):
            frame = image.copy()
            pointer(frame, end, index*FRAME_MS/1000)
            shots.append(Shot(frame, FRAME_MS))


def chat_export(source, attachments):
    original = source.read_text(encoding='utf-8-sig')
    sections = list(re.finditer(r'^## (User|ChatGPT) (\d+)[ \t]*$', original, re.MULTILINE))
    turns = []
    for index, section in enumerate(sections):
        if section[1] != 'User':
            continue
        end = sections[index+1].start() if index+1 < len(sections) else len(original)
        body = re.sub(r'\n\n---\s*$', '', original[section.end():end].strip()).strip()
        turns.append(body)
        if len(turns) == 3:
            break
    if len(turns) != 3:
        raise ValueError('演示需要前三轮用户消息。')
    replies = [
        '好，按这个顺序来。你先发定义。',
        '明白了，要让念头接着念头走，后一句既接得住，也要有新的东西。把例子发来吧。',
        '例子收到了。后面写的时候，就照着这种一句接一句往前走的感觉来。'
    ]
    resources = []
    parts = ['# 写出我想要的感觉', '', '**Source:** ChatGPT',
             '**Generator:** AI Chat Exporter (Detailed)', '']
    for index, (body, reply) in enumerate(zip(turns, replies), 1):
        def attach(match):
            name, mime = match[1].strip(), match[2].strip()
            file = (attachments / name).resolve()
            if not file.is_relative_to(attachments.resolve()):
                raise ValueError('附件路径超出指定目录：' + name)
            data = file.read_bytes()
            resources.append({'name': name, 'mimeType': mime, 'data': data,
                              'sha256': hashlib.sha256(data).hexdigest()})
            return f'- File · {name} · {mime} · See resource:R{len(resources)}'
        body = re.sub(r'^- File · ([^·]+) · ([^·\n]+)$', attach, body, flags=re.MULTILINE)
        parts.extend(['---', '', f'## User {index}', '', body, '',
                      '---', '', f'## ChatGPT {index}', '', reply, ''])
    parts.extend(['---', '', '## Resource appendix', ''])
    for index, resource in enumerate(resources, 1):
        fence = chr(96)*3
        parts.extend([f"### R{index} · {resource['name']}", '',
                      '- Type: ' + resource['mimeType'],
                      f"- Size: {len(resource['data'])} bytes",
                      '- Checksum: SHA-256 ' + resource['sha256'], '',
                      fence+'base64', base64.b64encode(resource['data']).decode(), fence, ''])
    return {'markdown': '\n'.join(parts), 'original': original, 'name': source.name,
            'replies': replies, 'resources': resources}


def edge_path():
    candidates = [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
                  Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')]
    return next(path for path in candidates if path.exists())


def capture_product(preview_dir, demo):
    from playwright.sync_api import sync_playwright
    shots = []
    with TemporaryDirectory(prefix='prompt-queue-media-') as profile:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile, executable_path=str(edge_path()), headless=True,
                viewport={'width': APP_SIZE[0], 'height': APP_SIZE[1]},
                device_scale_factor=SCALE, color_scheme='light', locale='zh-CN',
                args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}',
                      '--disable-background-networking'])
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
                base = '/'.join(worker.url.split('/')[:3])+'/'
                app = context.new_page()
                app.set_default_timeout(15000)
                errors = []
                app.on('pageerror', lambda error: errors.append(str(error)))
                worker.evaluate('''()=>chrome.storage.local.set({pcSelfTestSeeded:1})''')
                chat = context.new_page()
                chat.set_viewport_size({'width': CHAT_SIZE[0], 'height': CHAT_SIZE[1]})
                chat.route('https://chatgpt.com/**', lambda route: route.fulfill(
                    status=200, content_type='text/html', body=CHAT_HTML))
                chat.goto('https://chatgpt.com/c/prompt-queue-demo')
                chat.add_script_tag(path=str(ROOT/'vendor/marked/marked.js'))
                app.goto(base+'workflow.html?standalone=1')
                app.locator('#empty-state [data-action="import-chat"]').wait_for()
                app.locator('#target option').nth(1).wait_for(state='attached')
                read_steps = '''markdown => PromptFlowChatImport.parse(markdown).steps.slice(0,3).map(step => ({
                    text: step.text || '', names: (step.importAttachments || []).map(ref => ref.name)
                }))'''
                expected = app.evaluate(read_steps, demo['original'])
                assert app.evaluate(read_steps, demo['markdown']) == expected

                def frame():
                    image = browser_frame('chatgpt.com')
                    for page, offset in [(chat, CHAT_OFFSET), (app, APP_OFFSET)]:
                        source = Image.open(BytesIO(page.screenshot())).convert('RGB')
                        image.paste(source, scaled(offset))
                    draw = ImageDraw.Draw(image)
                    line(draw, [(470, 58), (470, 682)], LINE)
                    icon(image, (811, 24), 22)
                    return image

                def button_point(locator):
                    bounds = locator.bounding_box()
                    return (APP_OFFSET[0]+bounds['x']+bounds['width']/2,
                            APP_OFFSET[1]+bounds['y']+bounds['height']/2)

                def snapshot(name, duration=1000):
                    image = frame()
                    image.save(preview_dir/(name+'.png'))
                    append_hold(shots, image, duration)
                    print(name, flush=True)
                    return image

                def scroll_app(destination):
                    main = app.locator('#main')
                    start = main.evaluate('(el)=>el.scrollTop')
                    for index in range(8):
                        value = start+(destination-start)*ease((index+1)/8)
                        main.evaluate('(el,value)=>el.scrollTop=value', value)
                        append_hold(shots, frame(), FRAME_MS)

                first = snapshot('product-import', 1300)
                importing = app.locator('#empty-state [data-action="import-chat"]')
                import_point = button_point(importing)
                append_move(shots, first, (802, 580), import_point, click=True)
                with app.expect_file_chooser() as chooser:
                    importing.click()
                chooser.value.set_files({'name': demo['name'], 'mimeType': 'text/markdown',
                                         'buffer': demo['markdown'].encode('utf-8')})
                app.locator('#steps > .step').nth(2).wait_for()
                app.locator('#steps .attachment:not(.missing)').first.wait_for(state='attached')
                if app.locator('#notice:not([hidden]) .notice-close').count():
                    app.locator('#notice .notice-close').click()
                snapshot('product-editor', 1300)
                last_step = app.locator('#steps > .step').last
                destination = last_step.evaluate('''el => {
                    const main=document.querySelector('#main');
                    return main.scrollTop+el.getBoundingClientRect().top-main.getBoundingClientRect().top-18
                }''')
                scroll_app(destination)
                card = last_step.locator('.step-toggle')
                point = button_point(card)
                append_move(shots, frame(), import_point, point, 650, True)
                card.click()
                app.locator('#steps .attachment').last.wait_for()
                destination = app.locator('#steps .attachment').last.evaluate('''el=>{
                    const main=document.querySelector('#main');
                    return Math.min(main.scrollHeight-main.clientHeight,
                        main.scrollTop+el.getBoundingClientRect().bottom-main.getBoundingClientRect().bottom+20)
                }''')
                scroll_app(destination)
                snapshot('product-attachments', 1800)
                scroll_app(app.locator('#main').evaluate('(el)=>el.scrollHeight-el.clientHeight'))
                editing = snapshot('product-steps', 1500)
                run = app.locator('#run')
                append_move(shots, editing, (808, 440), button_point(run), 600, True)
                run.click()
                app.locator('#monitor-view').wait_for()
                if app.locator('#log-console').get_attribute('open') is not None:
                    app.locator('#log-console > summary').click()
                for index, (reply, prompt_hold, reply_hold) in enumerate(zip(
                    demo['replies'], (3200, 3600, 2000), (2800, 3200, 3000)
                )):
                    chat.wait_for_function('(count)=>delivered.length===count', arg=index+1)
                    snapshot('product-message-'+str(index+1), prompt_hold)
                    chat.evaluate('(text)=>showReply(text)', reply)
                    snapshot('product-reply-'+str(index+1), reply_hold)
                app.locator('#monitor-steps .done').nth(2).wait_for(timeout=30000)
                snapshot('product-completed', 2400)
                delivered = chat.evaluate('delivered')
                assert [{'text': item['text'].strip(), 'names': item['names']} for item in delivered] == expected, delivered
                stored = app.evaluate('''async () => {
                    const files = [];
                    for (const ref of editor.steps.flatMap(step => step.attachments)) {
                        const file = await PromptFlowStore.getFile(ref.id);
                        const digest = await crypto.subtle.digest('SHA-256', file.bytes);
                        files.push({name:ref.name, sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')});
                    }
                    return files;
                }''')
                assert stored == [{'name': ref['name'], 'sha256': ref['sha256']} for ref in demo['resources']]
                assert not errors, errors
                ending = shots[-1].image
                for index in range(8):
                    amount = ease((index+1)/8)
                    shots.append(Shot(Image.blend(ending, first, amount), FRAME_MS))
                print('Actual extension: source first 3 turns preserved, original attachment verified, 3 exchanges completed.',
                      flush=True)
                return shots
            except Exception:
                app.screenshot(path=str(preview_dir/'capture-error.png'))
                print(json.dumps({'url': app.url, 'pageErrors': errors,
                                  'page': app.locator('body').inner_text()[:1800]}, ensure_ascii=False),
                      flush=True)
                raise
            finally:
                context.close()


def folder(draw, x, y, size=24):
    factor = size/30
    points = [(0,4),(10,4),(14,9),(30,9),(30,25),(0,25),(0,4)]
    line(draw, [(x+a*factor, y+b*factor) for a,b in points], ACCENT, 1.5)


def toggle(draw, x, y, enabled):
    rectangle(draw, (x,y,x+34,y+18), ACCENT if enabled else '#eef1ef', LINE, 9)
    center = x+25 if enabled else x+9
    draw.ellipse(scaled((center-6,y+3,center+6,y+15)), fill='#fff' if enabled else '#819299')


def extensions_page(enabled=False, installed=False, address='edge://extensions'):
    image = browser_frame(address)
    draw = ImageDraw.Draw(image)
    draw.rectangle(scaled((15, 54, 234, 687)), fill='#f7f8f7')
    line(draw, [(235, 54), (235, 687)])
    text(draw, (37, 86), '扩展', 25, family='bold')
    rectangle(draw, (35, 133, 218, 164), '#fff', LINE, 4)
    text(draw, (48, 140), '搜索扩展', 12, MUTED)
    rectangle(draw, (34, 178, 218, 210), '#e5ecea', radius=4)
    line(draw, [(35, 182), (35, 206)], ACCENT, 3)
    text(draw, (51, 183), '我的扩展', 15)
    text(draw, (51, 225), '键盘快捷键', 15, MUTED)
    line(draw, [(35, 265), (217, 265)])
    text(draw, (37, 282), '获取 Microsoft Edge 扩展', 12, ACCENT)
    line(draw, [(35, 592), (217, 592)])
    text(draw, (37, 611), '开发人员模式', 14)
    toggle(draw, 181, 612, enabled)
    rectangle(draw, (263, 84, 836, 174), '#f4f7f4', radius=9)
    rectangle(draw, (281, 102, 327, 150), '#e0ece8', radius=9)
    for x, y in ((288, 110), (306, 110), (288, 128), (306, 128)):
        rectangle(draw, (x, y, x+13, y+13), '#8baeb2', radius=3)
    text(draw, (347, 101), '通过扩展个性化浏览器', 19, family='bold')
    text(draw, (347, 135), 'Microsoft Edge', 13, MUTED)
    text(draw, (263, 208), '已安装的扩展', 20, family='bold')
    if enabled:
        rectangle(draw, (425, 202, 619, 238), '#fff', LINE, 5)
        text(draw, (522, 220), '加载解压缩的扩展', 14, anchor='mm')
        text(draw, (645, 210), '打包扩展', 14, MUTED)
        text(draw, (754, 210), '更新', 14, MUTED)
    if installed:
        rectangle(draw, (263, 267, 836, 428), '#fff', LINE, 9)
        icon(image, (282, 290), 44)
        draw = ImageDraw.Draw(image)
        text(draw, (343, 287), 'PromptQueue', 22, family='bold')
        line(draw, [(264, 374), (835, 374)])
        text(draw, (284, 388), '详细信息', 14, ACCENT)
        text(draw, (389, 388), '移除', 14, MUTED)
        toggle(draw, 778, 390, True)
    else:
        text(draw, (263, 271), '尚未安装扩展', 15, MUTED)
    return image


def file_dialog(base, selected=False):
    image = base.copy()
    tint = Image.new('RGB', image.size, '#b3bdb9')
    image = Image.blend(image, tint, .22)
    draw = ImageDraw.Draw(image)
    rectangle(draw, (193, 135, 814, 526), '#fff', '#aebcba', 9)
    text(draw, (215, 150), '选择扩展目录', 16, family='bold')
    rectangle(draw, (215, 191, 793, 224), '#f6f8f6', LINE, 4)
    text(draw, (235, 197), '下载', 14, MUTED)
    line(draw, [(215, 243), (792, 243)])
    text(draw, (219, 262), '下载', 13, ACCENT)
    rectangle(draw, (316, 259, 791, 311), '#e8f0ef' if selected else '#fff',
              '#aac3c5' if selected else None, 4)
    folder(draw, 330, 273, 25)
    text(draw, (371, 274), ARCHIVE, 15)
    line(draw, [(215, 433), (792, 433)])
    text(draw, (216, 452), '文件夹：', 13, MUTED)
    rectangle(draw, (294, 446, 791, 478), '#fff', LINE, 3)
    if selected:
        text(draw, (307, 452), ARCHIVE, 14, family='mono')
    rectangle(draw, (649, 489, 792, 519), ACCENT if selected else '#e5ebe8', radius=4)
    text(draw, (720, 504), '选择文件夹', 14, '#fff' if selected else MUTED, anchor='mm')
    return image


def download_scene(extracted=False):
    image = Image.new('RGB', (WIDTH*SCALE, HEIGHT*SCALE), PAPER)
    draw = ImageDraw.Draw(image)
    rectangle(draw, (70, 115, 810, 575), '#fff', LINE, 12)
    text(draw, (96, 137), '下载', 23, family='bold')
    line(draw, [(71, 183), (809, 183)])
    rectangle(draw, (96, 199, 268, 234), '#e8f0ef', LINE, 5)
    text(draw, (182, 216), '全部解压缩', 15, anchor='mm')
    rectangle(draw, (97, 265, 784, 318), '#edf3f1', radius=5)
    folder(draw, 113, 278, 28)
    line(draw, [(128, 282), (128, 298)], '#7a9299')
    rectangle(draw, (125, 293, 132, 299), '#edf3f1', ACCENT, 1)
    text(draw, (161, 280), ARCHIVE+'.zip', 18, family='mono')
    if extracted:
        folder(draw, 113, 352, 28)
        text(draw, (161, 354), ARCHIVE, 18, family='mono')
    return image


def installation_shots(preview_dir):
    shots = []
    image = download_scene()
    append_hold(shots, image, 800)
    append_move(shots, image, (688, 446), (181, 216), 620, True)
    extracted = download_scene(True)
    append_hold(shots, extracted, 900)
    extracted.save(preview_dir/'install-unzip.png')
    address = 'edge://extensions'
    for length in range(1, len(address)+1):
        append_hold(shots, extensions_page(address=address[:length]), 65)
    empty = extensions_page()
    append_hold(shots, empty, 750)
    append_move(shots, empty, (704, 424), (199, 621), 750, True)
    enabled = extensions_page(True)
    append_hold(shots, enabled, 1000)
    enabled.save(preview_dir/'install-developer.png')
    append_move(shots, enabled, (199, 621), (522, 220), 800, True)
    dialog = file_dialog(enabled)
    append_hold(shots, dialog, 600)
    append_move(shots, dialog, (522, 220), (504, 286), 520, True)
    selected = file_dialog(enabled, True)
    append_hold(shots, selected, 850)
    selected.save(preview_dir/'install-folder.png')
    append_move(shots, selected, (504, 286), (721, 504), 650, True)
    installed = extensions_page(True, True)
    append_hold(shots, installed, 1400)
    installed.save(preview_dir/'install-ready.png')
    for index in range(6):
        shots.append(Shot(Image.blend(installed, image, ease((index+1)/6)), FRAME_MS))
    return shots


def encode(target, shots):
    sample_count = min(10, len(shots))
    samples = Image.new('RGB', (WIDTH*SCALE, HEIGHT*SCALE*sample_count))
    for index in range(sample_count):
        shot = shots[round(index*(len(shots)-1)/(sample_count-1))]
        samples.paste(shot.image, (0, index*HEIGHT*SCALE))
    palette = samples.quantize(colors=224, method=Image.Quantize.MEDIANCUT)
    images = [shot.image.quantize(palette=palette, dither=Image.Dither.NONE) for shot in shots]
    durations = [max(20, round(shot.duration/10)*10) for shot in shots]
    images[0].save(target, save_all=True, append_images=images[1:], loop=0,
                   duration=durations, optimize=True, disposal=1)
    return {'file': str(target), 'duration_ms': sum(durations), 'bytes': target.stat().st_size}


def build(preview_dir=None, only=None, chat=None, attachments=None):
    with TemporaryDirectory(prefix='prompt-queue-media-preview-') as temp:
        work = preview_dir or Path(temp)
        work.mkdir(parents=True, exist_ok=True)
        output = ROOT/'assets/readme'
        output.mkdir(parents=True, exist_ok=True)
        results = []
        if only != 'install':
            demo = chat_export(chat, attachments)
            frames = capture_product(work, demo)
            results.append(encode(output/'prompt-queue.gif', frames))
            del frames
        if only != 'product':
            frames = installation_shots(work)
            results.append(encode(output/'install.gif', frames))
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview-dir', type=Path)
    parser.add_argument('--only', choices=('product', 'install'))
    parser.add_argument('--chat', type=Path)
    parser.add_argument('--attachments', type=Path)
    arguments = parser.parse_args()
    if arguments.only != 'install' and (not arguments.chat or not arguments.attachments):
        parser.error('功能演示需要 --chat 和 --attachments。')
    build(arguments.preview_dir, arguments.only, arguments.chat, arguments.attachments)

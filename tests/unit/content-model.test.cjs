const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
let composer, locks;
before(async () => {
  composer = await import(pathToFileURL(path.join(__dirname, '../../content/composer.js')).href);
  locks = await import(pathToFileURL(path.join(__dirname, '../../content/send-lock.js')).href);
});

test('网页内 $ 触发保留数字、不可见字符和空白边界规则', () => {
  const cases = [
    ['',null], ['$',{query:'',shortcutIndex:0}], ['$Alpha',{query:'Alpha',shortcutIndex:0}],
    ['正文 $Alpha',{query:'Alpha',shortcutIndex:3}], ['正文\n$Alpha',{query:'Alpha',shortcutIndex:3}],
    ['正文\u00a0$Alpha',{query:'Alpha',shortcutIndex:3}], ['正文\t$Alpha',null], ['正文$Alpha',null],
    ['$123',null], ['$１２',{query:'１２',shortcutIndex:0}], ['$name space',null],
    ['$name\n',null], ['\u200B$Alpha',{query:'Alpha',shortcutIndex:1}],
    [' \u200B$Alpha',null], ['$中文',{query:'中文',shortcutIndex:0}],
    ['$a$b',{query:'a$b',shortcutIndex:0}], ['$a_b',{query:'a_b',shortcutIndex:0}]
  ];
  for (const [input, expected] of cases) assert.deepEqual(composer.shortcutQuery(input), expected, JSON.stringify(input));
});

test('网页发送锁互斥，待发队列优先，释放通知可取消订阅', () => {
  const lock = locks.createSendLock();
  let releases = 0;
  const unsubscribe = lock.subscribe(() => releases++);
  assert.equal(lock.getOwner(), null);
  assert.equal(lock.isBusy(), false);
  assert.equal(lock.tryAcquire('manual'), true);
  assert.equal(lock.tryAcquire('supervisor'), false);
  lock.release();
  assert.equal(releases, 1);
  lock.setQueuePending(2);
  assert.equal(lock.tryAcquire('manual'), false);
  assert.equal(lock.tryAcquire('supervisor'), false);
  assert.equal(lock.tryAcquire('queue'), true);
  lock.release();
  lock.setQueuePending(0);
  assert.equal(lock.tryAcquire('supervisor'), true);
  assert.equal(lock.tryAcquire('queue'), false);
  unsubscribe();
  lock.release();
  assert.equal(releases, 2);
  assert.equal(lock.getOwner(), null);
  assert.equal(lock.isBusy(), false);
});

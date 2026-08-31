/**
 * 性能探针：量化搜索与套包解析耗时，用于判断是否需要 loading 态 / 分片渲染。
 * 纯 Node 运行，不依赖 DOM。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var sandbox = { console: console, global: null, window: null };
sandbox.global = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}
load('web/js/search.js');
load('web/js/contract.js');

var raw = fs.readFileSync(path.join(ROOT, 'web/data/products.json'), 'utf8');

var t3 = Date.now();
var doc = JSON.parse(raw);
var tParse = Date.now() - t3;
var materials = doc.materials;

var t0 = Date.now();
var P = sandbox.PFSearch.index(materials);
var tIndex = Date.now() - t0;

var QUERIES = ['VS1000', 'VS', 'VS2000P-S', '5MP', '8MM', '97020006', 'VN4000', '相机', 'VS1000 111'];

console.log('物料总数: ' + materials.length);
console.log('建索引耗时: ' + tIndex + ' ms');
console.log('');
console.log('查询耗时（单次，ms）:');
QUERIES.forEach(function (q) {
  var n = 0, t = 0, worst = 0;
  for (var i = 0; i < 20; i++) {
    var s = Date.now();
    var r = sandbox.PFSearch.search(materials, q, { category: '', status: '', includeAccessory: true }, 300);
    var d = Date.now() - s;
    t += d; if (d > worst) worst = d; n = r.length;
  }
  console.log('  ' + pad(q, 14) + ' 命中 ' + pad(String(n), 5) + ' 平均 ' + (t / 20).toFixed(2) + ' ms  最差 ' + worst + ' ms');
});

// 套包解析
var picks = materials.filter(function (m) { return m.is_accessory !== 1; }).slice(0, 60);
var s2 = Date.now();
picks.forEach(function (m) { sandbox.PFContract.resolve(m, materials, '3M'); });
console.log('');
console.log('套包解析 60 次总耗时: ' + (Date.now() - s2) + ' ms');

console.log('products.json 解析耗时: ' + tParse + ' ms  (大小 ' + (raw.length / 1024).toFixed(0) + ' KB)');

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

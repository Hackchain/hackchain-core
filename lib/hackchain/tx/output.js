'use strict';

const assert = require('assert');
const BN = require('bn.js');

const TX = require('./');

function Output(value, script) {
  this.value = value;
  this.script = script;

  this.coinbase = false;
}
module.exports = Output;

Output.valueLength = 8;

Output.prototype.validate = function validate() {
  assert(this.value.byteLength() <= Output.valueLength,
         'Output: value is too big');
};

Output.parse = function parse(buf) {
  assert(buf.has(Output.valueLength), 'Output: not enough data for the header');

  const res = new Output(null, null);
  res.value = new BN(buf.take(Output.valueLength));
  res.script = TX.Script.parse(buf);

  return res;
};

Output.prototype.getBufferValue = function getBufferValue() {
  return this.value.toBuffer('be', Output.valueLength);
};

Output.prototype.render = function render(buf) {
  this.validate();

  buf.copyFrom(this.getBufferValue());
  this.script.render(buf);

  return buf;
};

Output.prototype.verify = function verify(chain, callback) {
  if (!this.coinbase && this.value.cmpn(0) === 0)
    return callback(new Error('Output: Empty value is disallowed'));
  this.script.verify('output', callback);
};

Output.prototype.inspect = function inspect(depth, opts, pad) {
  if (!pad)
    pad = '  ';

  let res = '<Output value: ' + this.value.toString(10)  + '\n';

  res += pad + 'script: ' + this.script.inspect(depth, opts, pad + '  ');

  return res + '>';
};

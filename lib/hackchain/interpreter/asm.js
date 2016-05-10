'use strict';

const assert = require('assert');
const WBuf = require('wbuf');

const REGS = {
  r0: 0,
  r1: 1,
  r2: 2,
  r3: 3,
  r4: 4,
  r5: 5,
  r6: 6,
  r7: 7
};

const IRQ = {
  success: 0,
  'yield': 1
};

function Assembler() {
  this.buffer = new WBuf();

  this.labels = new Map();

  this._codeOffset = 0;
}
module.exports = Assembler;

Assembler.prototype.render = function render(buf) {
  for (let label of this.labels.values())
    assert(label.pc !== null, `Assembler: label "${label.name}" unbound`);

  const chunks = this.buffer.render();
  for (let i = 0; i < chunks.length; i++)
    buf.copyFrom(chunks[i]);
  return buf;
};

// Masm

function Label(name) {
  this.pc = null;
  this.uses = [];

  this.name = name || 'unnamed';
};

Label.prototype.use = function use(asm, size, body) {
  if (this.pc === null)
    return this.uses.push({ buffer: asm.buffer.skip(size), generate: body });

  body(this.pc);
};

Assembler.prototype.codeOffset = function codeOffset(offset) {
  this._codeOffset = offset;
};

Assembler.prototype.label = function label(name) {
  if (this.labels.has(name))
    return this.labels.get(name);

  const label = new Label(name);
  this.labels.set(name, label);
  return label;
};

Assembler.prototype.bind = function bind(label) {
  if (!label)
    label = this.label();
  if (typeof label === 'string')
    label = this.label(label);

  label.pc = this._codeOffset + (this.buffer.size >> 1);

  const save = this.buffer;
  label.uses.forEach((entry) => {
    this.buffer = entry.buffer;
    entry.generate(label.pc);
  });
  this.buffer = save;

  this.uses = null;

  return label;
};

Assembler.prototype.jmp = function jmp(label) {
  assert.equal(arguments.length, 1, 'Assembler: `jmp` takes 1 argument');

  if (typeof label === 'string')
    label = this.label(label);

  label.use(this, 2, (pc) => {
    const delta = pc - ((this.buffer.size >> 1) + 1);
    assert(-64 <= delta && delta <= 63, 'Assembler: jump delta overflow');

    this.beq('r0', 'r0', delta);
  });
};

Assembler.prototype.farjmp = function farjmp(reg, label) {
  assert.equal(arguments.length, 2, 'Assembler: `farjmp` takes 2 arguments');
  assert(REGS[reg] !== undefined, `Assembler: unknown register ${reg}`);

  if (typeof label === 'string')
    label = this.label(label);

  label.use(this, 6, (pc) => {
    this.movi(reg, pc);
    this.jalr('r0', reg);
  });
};

Assembler.prototype.movi = function movi(reg, imm) {
  assert.equal(arguments.length, 2, 'Assembler: `movi` takes 2 arguments');
  assert(REGS[reg] !== undefined, `Assembler: unknown register ${reg}`);
  assert.equal(typeof imm, 'number', 'Assembler: `movi` expects immediate');

  assert(0 <= imm && imm <= 0xffff, 'Assembler: movi immediate overflow');
  this.lui(reg, imm & (~0x3f));
  this.addi(reg, reg, imm & 0x3f);
};

Assembler.prototype.nop = function nop() {
  assert.equal(arguments.length, 0, 'Assembler: `nop` takes no arguments');

  this.add('r0', 'r0', 'r0');
};

Assembler.prototype.hlt = function hlt() {
  assert.equal(arguments.length, 0, 'Assembler: `hlt` takes no arguments');

  this.beq('r0', 'r0', -1);
};

Assembler.prototype.data = function data(word) {
  assert.equal(arguments.length, 1, 'Assembler: `data` takes one argument');
  assert.equal(typeof word, 'number',
               'Assembler: `data` takes one 16-bit word argument');
  assert(0x0 <= word && word <= 0xffff, 'number',
         'Assembler: `data` argument does not fit into 16-bit word');

  this.buffer.writeUInt16LE(word);
};

Assembler.prototype.lea = function lea(reg, label) {
  assert.equal(arguments.length, 2, 'Assembler: `lea` takes 2 arguments');
  assert(REGS[reg] !== undefined, `Assembler: unknown register ${reg}`);

  if (typeof label === 'string')
    label = this.label(label);

  label.use(this, 4, (pc) => {
    this.movi(reg, pc);
  });
};

// Assembly

Assembler.prototype.add = function add(a, b, c) {
  assert.equal(arguments.length, 3, 'Assembler: `add` takes 3 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);
  assert(REGS[c] !== undefined, `Assembler: unknown register ${c}`);

  this.buffer.writeUInt16BE((REGS[a] << 10) | (REGS[b] << 7) | REGS[c]);
};

Assembler.prototype.addi = function addi(a, b, imm) {
  assert.equal(arguments.length, 3, 'Assembler: `addi` takes 3 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);
  assert.equal(typeof imm, 'number', 'Assembler: `addi` expects immediate');

  assert(-64 <= imm && imm <= 63, 'Assembler: addi immediate overflow');
  this.buffer.writeUInt16BE(
      (0x1 << 13) | (REGS[a] << 10) | (REGS[b] << 7) | ((imm >>> 0) & 0x7f));
};

Assembler.prototype.nand = function nand(a, b, c) {
  assert.equal(arguments.length, 3, 'Assembler: `nand` takes 3 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);
  assert(REGS[c] !== undefined, `Assembler: unknown register ${c}`);

  this.buffer.writeUInt16BE(
      (0x2 << 13) | (REGS[a] << 10) | (REGS[b] << 7) | REGS[c]);
};

Assembler.prototype.lui = function lui(a, imm) {
  assert.equal(arguments.length, 2, 'Assembler: `lui` takes 2 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert.equal(typeof imm, 'number', 'Assembler: `lui` expects immediate');

  assert(0 <= imm && imm <= 0xffff, 'Assembler: lui immediate overflow');
  assert((imm & 0x3f) === 0,
         'Assembler: lui immediate mask is 0xffc0');
  this.buffer.writeUInt16BE(
      (0x3 << 13) | (REGS[a] << 10) | ((imm >>> 6) & 0x3ff));
};

Assembler.prototype.sw = function sw(a, b, imm) {
  assert.equal(arguments.length, 3, 'Assembler: `sw` takes 3 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);
  assert.equal(typeof imm, 'number', 'Assembler: `sw` expects immediate');

  assert(-64 <= imm && imm <= 63, 'Assembler: `sw` immediate overflow');
  this.buffer.writeUInt16BE(
      (0x4 << 13) | (REGS[a] << 10) | (REGS[b] << 7) | ((imm >>> 0) & 0x7f));
};

Assembler.prototype.lw = function lw(a, b, imm) {
  assert.equal(arguments.length, 3, 'Assembler: `lw` takes 3 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);
  assert.equal(typeof imm, 'number', 'Assembler: `lw` expects immediate');

  assert(-64 <= imm && imm <= 63, 'Assembler: `lw` immediate overflow');
  this.buffer.writeUInt16BE(
      (0x5 << 13) | (REGS[a] << 10) | (REGS[b] << 7) | ((imm >>> 0) & 0x7f));
};

Assembler.prototype.beq = function beq(a, b, imm) {
  assert.equal(arguments.length, 3, 'Assembler: `beq` takes 3 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);
  assert.equal(typeof imm, 'number', 'Assembler: `beq` expects immediate');

  assert(-64 <= imm && imm <= 63, 'Assembler: `beq` immediate overflow');
  this.buffer.writeUInt16BE(
      (0x6 << 13) | (REGS[a] << 10) | (REGS[b] << 7) | ((imm >>> 0) & 0x7f));
};

Assembler.prototype.jalr = function jalr(a, b) {
  assert.equal(arguments.length, 2, 'Assembler: `jalr` takes 2 arguments');
  assert(REGS[a] !== undefined, `Assembler: unknown register ${a}`);
  assert(REGS[b] !== undefined, `Assembler: unknown register ${b}`);

  this.buffer.writeUInt16BE((0x7 << 13) | (REGS[a] << 10) | (REGS[b] << 7));
};

Assembler.prototype.irq = function irq(type) {
  assert.equal(arguments.length, 1, 'Assembler: `irq` takes 1 argument');
  assert(IRQ[type] !== undefined, `Assembler: unknown irq type "${type}"`);
  this.buffer.writeUInt16BE((0x7 << 13) | (IRQ[type] << 7) | 1);
};

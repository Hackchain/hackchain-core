'use strict';

const assert = require('assert');
const Buffer = require('buffer').Buffer;
const WBuf = require('wbuf');
const OBuf = require('obuf');

const hackchain = require('../../');
const Interpreter = hackchain.Interpreter;
const Assembler = Interpreter.Assembler;
const Disassembler = Interpreter.Disassembler;

describe('Interpreter/Macro-Assembler', () => {
  let asm;

  beforeEach(() => {
    asm = new Assembler();
  });

  afterEach(() => {
    asm = null;
  });

  function check(expected) {
    const wbuf = new WBuf();
    asm.render(wbuf);
    const contents = Buffer.concat(wbuf.render());

    const obuf = new OBuf();
    obuf.push(contents);
    const disasm = new Disassembler(obuf);

    assert.deepEqual(disasm.run(), expected);
  }

  it('should generate backward `jump`', () => {
    const label = asm.bind();
    asm.jmp(label);

    check([ { type: 'beq', a: 0, b: 0, imm: -1 } ]);
  });

  it('should generate forward `jump`', () => {
    const label = asm.label();
    asm.jmp(label);
    asm.bind(label);
    asm.nop();

    check([
      { type: 'beq', a: 0, b: 0, imm: 0 },
      { type: 'add', a: 0, b: 0, c: 0 }
    ]);
  });

  it('should generate `farjmp`', () => {
    const label = asm.label();
    asm.farjmp('r1', label);
    asm.nop();
    asm.bind(label);

    check([
      { type: 'lui', a: 1, imm: 0 },
      { type: 'addi', a: 1, b: 1, imm: 4 },
      { type: 'jalr', a: 0, b: 1 },
      { type: 'add', a: 0, b: 0, c: 0 }
    ]);
  });

  it('should generate `codeOffset`', () => {
    const label = asm.label();
    asm.farjmp('r1', label);
    asm.nop();

    asm.codeOffset(0x1000);
    asm.bind(label);

    check([
      { type: 'lui', a: 1, imm: 0x1000 },
      { type: 'addi', a: 1, b: 1, imm: 4 },
      { type: 'jalr', a: 0, b: 1 },
      { type: 'add', a: 0, b: 0, c: 0 }
    ]);
  });

  it('should generate `movi`', () => {
    asm.movi('r1', 0x1358);

    check([
      { type: 'lui', a: 1, imm: 0x1340 },
      { type: 'addi', a: 1, b: 1, imm: 0x18 }
    ]);
  });

  it('should generate `hlt`', () => {
    asm.hlt();

    check([
      { type: 'beq', a: 0, b: 0, imm: -1 }
    ]);
  });

  it('should generate `data`', () => {
    asm.data(0xffff);

    check([
      { type: '<invalid jalr>', raw: 0xffff }
    ]);
  });

  it('should generate backward-looking `lea`', () => {
    asm.codeOffset(0x1001);
    asm.bind('lbl');
    asm.lea('r1', 'lbl');

    check([
      { type: 'lui', a: 1, imm: 0x1000 },
      { type: 'addi', a: 1, b: 1, imm: 1 }
    ]);
  });

  it('should generate forward-looking `lea`', () => {
    asm.codeOffset(0x1000);
    asm.lea('r1', 'lbl');
    asm.bind('lbl');

    check([
      { type: 'lui', a: 1, imm: 0x1000 },
      { type: 'addi', a: 1, b: 1, imm: 2 }
    ]);
  });

  it('should generate backward `beq`', () => {
    const label = asm.bind();
    asm.beq('r0', 'r0', label);

    check([ { type: 'beq', a: 0, b: 0, imm: -1 } ]);
  });

  it('should generate forward `beq`', () => {
    const label = asm.label();
    asm.beq('r0', 'r0', label);

    asm.bind(label);

    check([ { type: 'beq', a: 0, b: 0, imm: 0 } ]);
  });

  it('should generate forward `beq` with codeOffset', () => {
    const label = asm.label();

    asm.codeOffset(0x1000);
    asm.beq('r0', 'r0', label);

    asm.bind(label);

    check([ { type: 'beq', a: 0, b: 0, imm: 0 } ]);
  });

  describe('named labels', () => {
    it('should generate named `jump`', () => {
      asm.jmp('lbl');
      asm.bind('lbl');
      asm.nop();

      check([
        { type: 'beq', a: 0, b: 0, imm: 0 },
        { type: 'add', a: 0, b: 0, c: 0 }
      ]);
    });

    it('should generate named `farjmp`', () => {
      asm.farjmp('r1', 'lbl');
      asm.nop();
      asm.bind('lbl');

      check([
        { type: 'lui', a: 1, imm: 0 },
        { type: 'addi', a: 1, b: 1, imm: 4 },
        { type: 'jalr', a: 0, b: 1 },
        { type: 'add', a: 0, b: 0, c: 0 }
      ]);
    });
  });
});

'use strict';

const Buffer = require('buffer').Buffer;

const hackchain = require('../../core');

const interpreter = new hackchain.Interpreter();

process.on('message', (data) => {
  interpreter.clear();

  const hash = Buffer.from(data.hash, 'hex');
  const input = Buffer.from(data.input, 'hex');
  const output = Buffer.from(data.output, 'hex');

  interpreter.run({
    hash: hash,
    input: input,
    output: output
  }, (err, result) => {
    if (err)
      return process.send({ error: err.message, result: result });

    process.send({ error: null, result: result });
  });
});

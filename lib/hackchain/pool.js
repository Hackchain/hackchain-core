'use strict';

const assert = require('assert');
const async = require('async');
const debug = require('debug')('hc:pool');
const BN = require('bn.js');
const WBuf = require('wbuf');

const hackchain = require('../core');
const Block = hackchain.Block;
const TX = hackchain.TX;

function Pool(chain, options) {
  assert.equal(typeof options.size, 'number',
               'Pool: options.size not number');
  assert.equal(typeof options.interval, 'number',
               'Pool: options.interval not number');
  assert.equal(typeof options.coinbaseInterval, 'number',
               'Pool: options.coinbaseInterval not number');

  this.chain = chain;
  this.size = options.size;
  this.txs = {
    list: [],
    spent: {}
  };

  this.timer = null;
  this.timerInterval = options.interval;
  this.timerCoinbaseInterval = options.coinbaseInterval;
  this.nextBlockTime = Infinity;
  this.nextCoinbaseTime = Infinity;

  this.version = Pool.version;

  this.initialized = false;
}
module.exports = Pool;

Pool.version = 1;

const poolTXCompare = (a, b) => {
  // Highest fee - first
  return b.fee.cmp(a.fee);
};

Pool.prototype.accept = function accept(tx, callback) {
  const hash = tx.hash().toString('hex');
  debug('verify tx=%s', hash);

  async.parallel({
    poolSpend: (callback) => {
      for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];

        if (this.txs.spent[input.hash.toString('hex') + '/' + input.index])
          return callback(new Error('Pool: Double-spend attempt'));
      }

      callback(null);
    },
    doubleSpend: (callback) => {
      tx.checkDoubleSpend(this.chain, callback);
    },
    verify: (callback) => {
      tx.verify(this.chain, callback);
    },
    fee: (callback) => {
      tx.getFee(this.chain, callback);
    }
  }, (err, data) => {
    if (err) {
      debug('verify tx=%s failure', hash);

      return callback(err);
    }

    debug('verify tx=%s success', hash);

    assert(data.verify, 'Sanity check');

    if (this.txs.list.length === this.size) {
      debug('accept tx=%s full pool', hash);

      this.evict(data.fee, (err) => {
        if (err) {
          debug('accept tx=%s can\'t evict', hash);
          return callback(err);
        }

        debug('accept tx=%s', hash);

        this.insertTX(tx, data.fee, callback);
      });
      return;
    }

    debug('accept tx=%s', hash);

    this.insertTX(tx, data.fee, callback);
  });
};

Pool.prototype.insertTX = function insertTX(tx, fee, callback) {
  const entry = { tx: tx, fee: fee };

  const index = hackchain.utils.binarySearch(
      this.txs.list, entry, poolTXCompare);
  this.txs.list.splice(index, 0, entry);

  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];
    this.txs.spent[input.hash.toString('hex') + '/' + input.index] = true;
  }

  this.chain.storePoolTX(tx, callback);
};

Pool.prototype.evict = function evict(fee, callback) {
  if (this.txs.list.length === 0)
    return callback(new Error('Pool: Empty tx list'));

  const last = this.txs.list[this.txs.list.length - 1];
  if (last.fee.cmp(fee) >= 0)
    return callback(new Error('Pool: Fee is too low to fit into'));

  this.txs.list.pop();
  for (let i = 0; i < last.tx.inputs.length; i++) {
    const input = last.tx.inputs[i];
    delete this.txs.spent[input.hash.toString('hex') + '/' + input.index];
  }

  this.chain.removePoolTX(last.tx.hash(), callback);
};

Pool.prototype.nextBlockIn = function nextBlockIn() {
  return Math.max(0, this.nextBlockTime - (+new Date));
};

Pool.prototype.nextCoinbaseIn = function nextCoinbaseIn() {
  return Math.max(0, this.nextCoinbaseTime - (+new Date));
};

Pool.prototype.init = function init(callback) {
  const done = (err) => {
    this.save(callback);
  };

  async.parallel({
    state: (callback) => {
      this.chain.getPoolState(callback);
    },
    txs: (callback) => {
      this.chain.getPoolTXs(callback);
    }
  }, (err, data) => {
    if (err) {
      debug(err.message);
      this.initialized = true;
      return done(null);
    }

    const state = data.state;
    const txs = data.txs;

    if (state.version === Pool.version) {
      this.nextCoinbaseTime = state.nextCoinbaseTime;
      this.nextBlockTime = state.nextBlockTime;
    }

    async.forEach(txs, (tx, callback) => {
      this.accept(tx, (err) => {
        if (err) {
          debug(err.message);

          // No need to keep failing TXs
          return this.chain.removePoolTX(tx.hash(), callback);
        }

        callback(null);
      });
    }, (err) => {
      if (err)
        debug(err.message);

      this.initialized = true;
      done(null);
    });
  });
};

Pool.prototype.save = function save(callback) {
  const state = {
    version: this.version,
    nextCoinbaseTime: this.nextCoinbaseTime,
    nextBlockTime: this.nextBlockTime
  };

  this.chain.storePoolState(state, (err) => {
    if (err)
      debug(err.message);

    if (callback)
      callback(null);
  });
};

Pool.prototype.start = function start() {
  if (this.timer !== null)
    return;

  // Only manual `mint` with `interval = 0`
  if (this.timerInterval === 0)
    return;

  assert(this.initialized, 'Pool: must call `.init()` first');

  if (this.nextBlockTime === Infinity)
    this.nextBlockTime = +new Date + this.timerInterval;

  // No coinbase with `coinbaseInterval = 0`
  if (this.nextCoinbaseTime === Infinity && this.timerCoinbaseInterval !== 0)
    this.nextCoinbaseTime = +new Date + this.timerCoinbaseInterval;

  this.save();

  const now = +new Date;
  const interval = Math.max(
    0,
    Math.min(this.nextBlockTime, this.nextCoinbaseTime) - now);

  this.timer = setTimeout(() => {
    const now = +new Date;

    this.timer = null;
    this.nextBlockTime = Infinity;

    // Reset coinbase time
    const coinbase = now >= this.nextCoinbaseTime;
    if (coinbase)
      this.nextCoinbaseTime = +new Date + this.timerCoinbaseInterval;

    this.save();

    // Skip the block if there are no coins in it
    if (this.txs.list.length === 0 && !coinbase)
      return this.start();

    this.mint(coinbase ? hackchain.constants.coinbase : new BN(0), () => {
      this.start();
    });
  }, interval);
};

Pool.prototype.mint = function mint(value, callback) {
  assert(this.initialized, 'Pool: must call `.init()` first');
  debug('mint');

  const txs = this.txs;
  this.txs = { list: [], spent: {} };

  const block = new Block(this.chain.lastBlock);

  const coinbase = new TX();

  // Isn't checked, just to ensure that coinbase will have unique hash
  coinbase.input(this.chain.lastBlock, 0xffffffff, new TX.Script());

  let fees = new BN(0);
  for (let i = 0; i < txs.list.length; i++)
    fees.iadd(txs.list[i].fee);

  // coinbase.value = default + fees
  coinbase.output(value.add(fees),
                  new TX.Script(hackchain.constants.coinbaseScript));

  block.addCoinbase(coinbase);

  debug('minted coinbase=%s value=%s',
        coinbase.hash().toString('hex'),
        coinbase.outputs[0].value.toString());

  for (let i = 0; i < txs.list.length; i++)
    block.addTX(txs.list[i].tx);

  const hash = block.hash().toString('hex');
  debug('storing block=%s', hash);

  async.waterfall([
    (callback) => {
      this.chain.storeBlock(block, callback);
    },
    (callback) => {
      async.forEach(txs.list, (entry, callback) => {
        this.chain.removePoolTX(entry.tx.hash(), callback);
      }, callback);
    }
  ], (err) => {
    // TODO(indutny): gracefully exit?
    if (err)
      throw err;

    debug('storing block=%s done', hash);
    callback(null, block);
  });
};

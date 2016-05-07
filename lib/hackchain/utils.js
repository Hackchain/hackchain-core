'use strict';

const util = require('util');

exports.binarySearch = function binarySearch(haystack, needle, compare) {
  let left = 0;
  let right = haystack.length - 1;

  while (left <= right) {
    const middle = (left + right) >>> 1;
    const cmp = compare(needle, haystack[middle]);

    if (cmp === 0)
      return middle;
    else if (cmp < 0)
      right = middle - 1;
    else
      left = middle + 1;
  }

  return left;
};

exports.inspectArray = function inspectArray(array, pad) {
  return '[\n' + array.map((item, i) => {
    return `${pad}${i}: ${item.inspect(0, {}, pad + '  ')}`
  }).join('\n') + ']';
};

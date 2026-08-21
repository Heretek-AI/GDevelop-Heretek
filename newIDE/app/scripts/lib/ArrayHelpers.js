// @ts-check

/**
 * @template T
 * @param {Array<T>} array
 * @param {(T) => string} getKey
 * @returns {Record<string, Array<T>>}
 */
const groupBy = (array, getKey) => {
  /** @type {Record<string, Array<T>>} */
  const table = {};
  for (const element of array) {
    const key = getKey(element);
    let group = table[key];
    if (!group) {
      group = [];
      table[key] = group;
    }
    group.push(element);
  }
  return table;
};

/**
 * @template T
 * @param {Record<string, Array<T>>} table
 * @returns {Record<string, Array<T>>}
 */
const sortKeys = table => {
  /** @type {Record<string, Array<T>>} */
  const sortedTable = {};
  // Use localeCompare for alphabetical ordering of non-ASCII keys.
  // (closes javascript:S2871 — default Array#sort uses UTF-16 code unit
  // order, which gives wrong results for accented characters)
  for (const key of Object.keys(table).sort((a, b) =>
    a.localeCompare(b, 'en-US')
  )) {
    sortedTable[key] = table[key];
  }
  return sortedTable;
};

module.exports = {
  groupBy,
  sortKeys,
};
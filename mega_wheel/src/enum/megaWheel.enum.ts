export const outerWheel = [
  [...Array(9).fill(2), ...Array(11).fill(0)],
  [...Array(9).fill(3), ...Array(21).fill(0)],
  [...Array(9).fill(10), ...Array(91).fill(0)],
  [...Array(9).fill(35), ...Array(341).fill(0)],
];

export const middleWheel = [
  [...Array(3).fill(1.5), ...Array(2).fill(0)],
  [...Array(9).fill(2), ...Array(11).fill(0)],
  [...Array(9).fill(5), ...Array(41).fill(0)],
  ['next'],
];

export const innerWheel = [
  [...Array(12).fill(1.5), ...Array(4).fill(0.5), ...Array(4).fill(0)],
  [...Array(9).fill(1), ...Array(1).fill(0)],
  ['next'],
];
export type Decimal = {
  integer: bigint;
  scale: number;
};

const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

const powerOfTen = (scale: number): bigint => 10n ** BigInt(scale);

export function parseDecimal(value: string | number | bigint): Decimal {
  const text = typeof value === "string" ? value : value.toString();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new Error(`Invalid decimal value: ${text}`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const fractional = match[3] ?? "";
  return {
    integer: sign * BigInt(`${match[2]}${fractional}` || "0"),
    scale: fractional.length,
  };
}

const align = (left: Decimal, right: Decimal): [bigint, bigint, number] => {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.integer * powerOfTen(scale - left.scale),
    right.integer * powerOfTen(scale - right.scale),
    scale,
  ];
};

export function add(left: Decimal, right: Decimal): Decimal {
  const [leftInteger, rightInteger, scale] = align(left, right);
  return { integer: leftInteger + rightInteger, scale };
}

export function subtract(left: Decimal, right: Decimal): Decimal {
  const [leftInteger, rightInteger, scale] = align(left, right);
  return { integer: leftInteger - rightInteger, scale };
}

export function multiply(left: Decimal, right: Decimal): Decimal {
  return { integer: left.integer * right.integer, scale: left.scale + right.scale };
}

const roundQuotient = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero");
  }

  const sign = numerator < 0n === denominator < 0n ? 1n : -1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  let quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  if (remainder * 2n >= absoluteDenominator) {
    quotient += 1n;
  }
  return sign * quotient;
};

export function divide(left: Decimal, right: Decimal, outputScale: number): Decimal {
  if (!Number.isInteger(outputScale) || outputScale < 0) {
    throw new Error("Output scale must be a non-negative integer");
  }
  const numerator = left.integer * powerOfTen(outputScale + right.scale);
  const denominator = right.integer * powerOfTen(left.scale);
  return { integer: roundQuotient(numerator, denominator), scale: outputScale };
}

export function roundToScale(value: Decimal, outputScale: number): Decimal {
  if (!Number.isInteger(outputScale) || outputScale < 0) {
    throw new Error("Output scale must be a non-negative integer");
  }
  if (value.scale <= outputScale) {
    return { integer: value.integer * powerOfTen(outputScale - value.scale), scale: outputScale };
  }

  return {
    integer: roundQuotient(value.integer, powerOfTen(value.scale - outputScale)),
    scale: outputScale,
  };
}

export function compare(left: Decimal, right: Decimal): -1 | 0 | 1 {
  const [leftInteger, rightInteger] = align(left, right);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

export function isZero(value: Decimal): boolean {
  return value.integer === 0n;
}

export function formatDecimal(value: Decimal, outputScale = value.scale): string {
  const rounded = roundToScale(value, outputScale);
  const sign = rounded.integer < 0n ? "-" : "";
  const absolute = rounded.integer < 0n ? -rounded.integer : rounded.integer;
  const digits = absolute.toString().padStart(rounded.scale + 1, "0");
  if (rounded.scale === 0) {
    return `${sign}${digits}`;
  }
  const split = digits.length - rounded.scale;
  return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`;
}

export function toMoney(value: Decimal): string {
  return formatDecimal(value, 2);
}

export function toQuantity(value: Decimal): string {
  return formatDecimal(value, 3);
}

export function toPercentage(value: Decimal): string {
  return formatDecimal(value, 2);
}

export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => add(total, value), { integer: 0n, scale: 0 });
}

export function median(values: readonly Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error("Cannot calculate a median of an empty collection");
  }
  const ordered = [...values].sort(compare);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) {
    return ordered[middle]!;
  }
  return divide(add(ordered[middle - 1]!, ordered[middle]!), parseDecimal(2), 6);
}

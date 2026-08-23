import { compare, median, parseDecimal, subtract, toMoney, toQuantity } from "./decimal.ts";

export type MenuProductInput = {
  productId: string;
  active: boolean;
  unitsSold: string;
  currentPrice: string;
  currentUnitCost: string;
};

export type MenuClassification = {
  productId: string;
  unitsSold: string;
  unitContribution: string;
  group: "stars" | "workhorses" | "puzzles" | "dogs";
  recommendation:
    "protect_and_promote" | "improve_margin" | "promote_and_test" | "review_or_remove";
};

const recommendationFor = (
  group: MenuClassification["group"],
): MenuClassification["recommendation"] => {
  switch (group) {
    case "stars":
      return "protect_and_promote";
    case "workhorses":
      return "improve_margin";
    case "puzzles":
      return "promote_and_test";
    case "dogs":
      return "review_or_remove";
  }
};

export function classifyMenuProducts(products: readonly MenuProductInput[]): {
  medians: { unitsSold: string; unitContribution: string };
  products: MenuClassification[];
} {
  const activeProducts = products.filter((product) => product.active);
  if (activeProducts.length === 0) {
    return { medians: { unitsSold: "0.000", unitContribution: "0.00" }, products: [] };
  }

  const withContribution = activeProducts.map((product) => ({
    product,
    unitsSold: parseDecimal(product.unitsSold),
    unitContribution: subtract(
      parseDecimal(product.currentPrice),
      parseDecimal(product.currentUnitCost),
    ),
  }));
  const unitsMedian = median(withContribution.map(({ unitsSold }) => unitsSold));
  const contributionMedian = median(
    withContribution.map(({ unitContribution }) => unitContribution),
  );
  const classified = withContribution.map(({ product, unitsSold, unitContribution }) => {
    const popular = compare(unitsSold, unitsMedian) >= 0;
    const profitable = compare(unitContribution, contributionMedian) >= 0;
    const group =
      popular && profitable ? "stars" : popular ? "workhorses" : profitable ? "puzzles" : "dogs";
    return {
      productId: product.productId,
      unitsSold: toQuantity(unitsSold),
      unitContribution: toMoney(unitContribution),
      group,
      recommendation: recommendationFor(group),
    } satisfies MenuClassification;
  });

  return {
    medians: { unitsSold: toQuantity(unitsMedian), unitContribution: toMoney(contributionMedian) },
    products: classified,
  };
}
